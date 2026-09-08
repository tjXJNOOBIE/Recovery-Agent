import assert from 'node:assert/strict'
import test from 'node:test'

import type { RecoveryControlRuntime } from '../../src/control/runtime/RecoveryControlRuntime.js'
import type { RecoveryRunResult } from '../../src/control/recovery/RecoveryRunResult.js'
import { RecoveryWatchService, type RecoveryServiceWatchRuntime } from '../../src/control/watch/RecoveryWatchService.js'
import type { RecoveryWatchSurface } from '../../src/control/watch/RecoveryWatchSurface.js'
import type { IRecoverySemanticWatchCompiler, RecoverySemanticWatchProposal } from '../../src/control/watch/semantic/RecoverySemanticWatch.js'
import { RecoverySemanticWatchService } from '../../src/control/watch/semantic/RecoverySemanticWatchService.js'
import { RecoveryMcpToolRouter } from '../../src/mcp/RecoveryMcpToolRouter.js'

class Compiler implements IRecoverySemanticWatchCompiler {
  public calls = 0
  public async compile(_request: string): Promise<RecoverySemanticWatchProposal> {
    this.calls += 1
    return { nodeId: 'east', serviceId: 'payments', intervalSeconds: this.calls === 1 ? 120 : 180, rationale: 'compiled' }
  }
}

const recoveryRuntime: RecoveryServiceWatchRuntime = {
  async recoverService(nodeId: string, serviceId: string): Promise<RecoveryRunResult> {
    return {
      status: 'healthy', restartAttempts: 0,
      snapshot: { nodeId, serviceId, lifecycleState: 'running', healthy: true, detail: 'healthy', observedAt: '2026-09-08T11:00:00.000Z', restartCount: 0 },
    }
  },
}

const watchSurface: RecoveryWatchSurface = {
  listStates: () => ({ source: 'built-in' }),
  runAllNow: async () => ({ ran: true }),
}

test('routesSemanticWatchCreateUpdateRemoveWithoutChangingDeterministicRunPath', async () => {
  const serviceWatches = new RecoveryWatchService(recoveryRuntime, [{ nodeId: 'east', serviceId: 'payments', intervalMs: 30_000 }])
  const compiler = new Compiler()
  const semantic = new RecoverySemanticWatchService(compiler, serviceWatches)
  const router = new RecoveryMcpToolRouter({} as RecoveryControlRuntime, watchSurface, semantic)

  const toolNames = router.listTools().map((tool) => tool.name)
  assert.ok(toolNames.includes('watch_create'))
  assert.ok(toolNames.includes('watch_update'))
  assert.ok(toolNames.includes('watch_remove'))

  const created = await router.callTool('watch_create', { request: 'Watch payments every two minutes' }) as {watchId: string; intervalMs: number}
  assert.equal(created.intervalMs, 120_000)
  assert.equal(compiler.calls, 1)

  const listed = await router.callTool('watch_list') as {semanticWatches: readonly {watchId: string}[]}
  assert.equal(listed.semanticWatches[0]?.watchId, created.watchId)

  const updated = await router.callTool('watch_update', { watchId: created.watchId, request: 'Watch payments every three minutes' }) as {intervalMs: number}
  assert.equal(updated.intervalMs, 180_000)
  assert.equal(compiler.calls, 2)

  await router.callTool('watch_run')
  assert.equal(compiler.calls, 2)

  await router.callTool('watch_remove', { watchId: created.watchId })
  assert.equal(serviceWatches.listStates()[0]?.intervalMs, 30_000)
})
