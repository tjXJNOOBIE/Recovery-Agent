import assert from 'node:assert/strict'
import test from 'node:test'

import type { IRecoveryDurabilityCheckpoint } from '../../src/control/durability/RecoveryDurabilityCheckpointBarrier.js'
import type { RecoveryDurableAuditRequest, RecoveryDurableCheckpointOverrides } from '../../src/control/durability/RecoveryDurableStateCoordinator.js'
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

class MultiTargetCompiler implements IRecoverySemanticWatchCompiler {
  public calls = 0
  public async compile(_request: string): Promise<RecoverySemanticWatchProposal> {
    this.calls += 1
    return this.calls === 1
      ? { nodeId: 'east', serviceId: 'payments', intervalSeconds: 120, rationale: 'payments compiled' }
      : { nodeId: 'east', serviceId: 'worker', intervalSeconds: 180, rationale: 'worker compiled' }
  }
}

class ControlledCheckpoint implements IRecoveryDurabilityCheckpoint {
  public calls = 0
  public readonly candidates: string[][] = []
  private releaseFirst: (() => void) | undefined

  public assertMutationAllowed(): void {}

  public checkpoint(
    _request: RecoveryDurableAuditRequest,
    overrides?: RecoveryDurableCheckpointOverrides,
  ): Promise<void> {
    this.calls += 1
    this.candidates.push((overrides?.semanticWatches ?? []).map((definition) => `${definition.nodeId}/${definition.serviceId}:${definition.intervalMs}`))
    if (this.calls !== 1) return Promise.resolve()
    return new Promise<void>((resolve) => { this.releaseFirst = resolve })
  }

  public release(): void {
    assert.ok(this.releaseFirst)
    this.releaseFirst()
  }
}

class FailingCheckpoint implements IRecoveryDurabilityCheckpoint {
  public assertMutationAllowed(): void {}
  public async checkpoint(
    _request: RecoveryDurableAuditRequest,
    _overrides?: RecoveryDurableCheckpointOverrides,
  ): Promise<void> {
    throw new Error('durable write failed')
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

function intervalFor(serviceWatches: RecoveryWatchService, serviceId: string): number | undefined {
  return serviceWatches.listStates().find((state) => state.serviceId === serviceId)?.intervalMs
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
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

test('doesNotActivateSemanticWatchUntilDurableCandidateCommitsAndSerializesConcurrentMutations', async () => {
  const serviceWatches = new RecoveryWatchService(recoveryRuntime, [
    { nodeId: 'east', serviceId: 'payments', intervalMs: 30_000 },
    { nodeId: 'east', serviceId: 'worker', intervalMs: 30_000 },
  ])
  const compiler = new MultiTargetCompiler()
  const semantic = new RecoverySemanticWatchService(compiler, serviceWatches)
  const checkpoint = new ControlledCheckpoint()
  const router = new RecoveryMcpToolRouter({} as RecoveryControlRuntime, watchSurface, semantic, checkpoint)

  const first = router.callTool('watch_create', { request: 'Watch payments every two minutes' })
  await nextTurn()

  assert.equal(compiler.calls, 1)
  assert.equal(checkpoint.calls, 1)
  assert.deepEqual(semantic.list(), [])
  assert.equal(intervalFor(serviceWatches, 'payments'), 30_000)
  assert.equal(intervalFor(serviceWatches, 'worker'), 30_000)
  assert.deepEqual(checkpoint.candidates[0], ['east/payments:120000'])

  const second = router.callTool('watch_create', { request: 'Watch worker every three minutes' })
  await nextTurn()
  assert.equal(compiler.calls, 1, 'second semantic compile must wait for the first commit/apply transaction')

  checkpoint.release()
  await first
  await second

  assert.equal(compiler.calls, 2)
  assert.equal(checkpoint.calls, 2)
  assert.equal(intervalFor(serviceWatches, 'payments'), 120_000)
  assert.equal(intervalFor(serviceWatches, 'worker'), 180_000)
  assert.deepEqual(
    semantic.list().map((definition) => `${definition.nodeId}/${definition.serviceId}`).sort(),
    ['east/payments', 'east/worker'],
  )
  assert.deepEqual(checkpoint.candidates[1]?.sort(), ['east/payments:120000', 'east/worker:180000'])
})

test('failedSemanticWatchCheckpointLeavesDefinitionsAndSchedulerAtCommittedBaseline', async () => {
  const serviceWatches = new RecoveryWatchService(recoveryRuntime, [{ nodeId: 'east', serviceId: 'payments', intervalMs: 30_000 }])
  const semantic = new RecoverySemanticWatchService(new Compiler(), serviceWatches)
  const router = new RecoveryMcpToolRouter({} as RecoveryControlRuntime, watchSurface, semantic, new FailingCheckpoint())

  await assert.rejects(
    router.callTool('watch_create', { request: 'Watch payments every two minutes' }),
    /durable write failed/,
  )

  assert.deepEqual(semantic.list(), [])
  assert.equal(intervalFor(serviceWatches, 'payments'), 30_000)
})
