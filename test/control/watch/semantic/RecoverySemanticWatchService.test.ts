import assert from 'node:assert/strict'
import test from 'node:test'

import type { RecoveryRunResult } from '../../../../src/control/recovery/RecoveryRunResult.js'
import { RecoveryWatchService, type RecoveryServiceWatchRuntime } from '../../../../src/control/watch/RecoveryWatchService.js'
import type { IRecoverySemanticWatchCompiler, RecoverySemanticWatchProposal } from '../../../../src/control/watch/semantic/RecoverySemanticWatch.js'
import { RecoverySemanticWatchService } from '../../../../src/control/watch/semantic/RecoverySemanticWatchService.js'

class SequencedCompiler implements IRecoverySemanticWatchCompiler {
  public calls = 0
  private readonly proposals: RecoverySemanticWatchProposal[]
  public constructor(proposals: readonly RecoverySemanticWatchProposal[]) { this.proposals = [...proposals] }
  public async compile(_request: string): Promise<RecoverySemanticWatchProposal> {
    const proposal = this.proposals[this.calls]
    this.calls += 1
    if (proposal === undefined) throw new Error('No semantic watch proposal configured')
    return proposal
  }
}

class BlockingUpdateCompiler implements IRecoverySemanticWatchCompiler {
  public calls = 0
  private releaseUpdate: ((proposal: RecoverySemanticWatchProposal) => void) | undefined

  public async compile(_request: string): Promise<RecoverySemanticWatchProposal> {
    this.calls += 1
    if (this.calls === 1) return paymentsProposal
    return new Promise<RecoverySemanticWatchProposal>((resolve) => { this.releaseUpdate = resolve })
  }

  public release(proposal: RecoverySemanticWatchProposal): void {
    const release = this.releaseUpdate
    if (release === undefined) throw new Error('Update compilation is not waiting')
    this.releaseUpdate = undefined
    release(proposal)
  }
}

class CountingRecoveryRuntime implements RecoveryServiceWatchRuntime {
  public calls = 0
  public async recoverService(nodeId: string, serviceId: string): Promise<RecoveryRunResult> {
    this.calls += 1
    return {
      status: 'healthy',
      restartAttempts: 0,
      snapshot: {
        nodeId,
        serviceId,
        lifecycleState: 'running',
        healthy: true,
        detail: 'healthy',
        observedAt: '2026-09-08T11:00:00.000Z',
        restartCount: 0,
      },
    }
  }
}

const paymentsProposal: RecoverySemanticWatchProposal = {
  nodeId: 'east', serviceId: 'payments', intervalSeconds: 120, rationale: 'Two-minute watch.',
}

test('compilesOnceThenRunsDeterministicallyAndRestoresBuiltInIntervalOnRemove', async () => {
  const runtime = new CountingRecoveryRuntime()
  const serviceWatches = new RecoveryWatchService(runtime, [{ nodeId: 'east', serviceId: 'payments', intervalMs: 30_000 }])
  const compiler = new SequencedCompiler([paymentsProposal])
  const semantic = new RecoverySemanticWatchService(compiler, serviceWatches)

  const created = await semantic.create('Watch payments every two minutes')
  assert.equal(compiler.calls, 1)
  assert.equal(serviceWatches.listStates()[0]?.intervalMs, 120_000)

  await serviceWatches.runDueWatches(0)
  await serviceWatches.runDueWatches(60_000)
  await serviceWatches.runDueWatches(120_000)
  assert.equal(runtime.calls, 2)
  assert.equal(compiler.calls, 1)

  semantic.remove(created.watchId)
  assert.equal(serviceWatches.listStates()[0]?.intervalMs, 30_000)
})

test('removingDynamicSemanticWatchRemovesTargetWhenNoBuiltInWatchExists', async () => {
  const serviceWatches = new RecoveryWatchService(new CountingRecoveryRuntime(), [])
  const semantic = new RecoverySemanticWatchService(new SequencedCompiler([paymentsProposal]), serviceWatches)
  const created = await semantic.create('Watch payments every two minutes')
  assert.equal(serviceWatches.listStates().length, 1)
  semantic.remove(created.watchId)
  assert.equal(serviceWatches.listStates().length, 0)
})

test('semanticWatchUpdateCannotRetargetExistingWatch', async () => {
  const serviceWatches = new RecoveryWatchService(new CountingRecoveryRuntime(), [])
  const compiler = new SequencedCompiler([
    paymentsProposal,
    { nodeId: 'west', serviceId: 'worker', intervalSeconds: 60, rationale: 'retarget attempt' },
  ])
  const semantic = new RecoverySemanticWatchService(compiler, serviceWatches)
  const created = await semantic.create('Watch payments')
  await assert.rejects(semantic.update(created.watchId, 'Actually watch worker'), /cannot retarget/)
  assert.equal(semantic.list()[0]?.nodeId, 'east')
  assert.equal(serviceWatches.listStates()[0]?.serviceId, 'payments')
})

test('removeWinningRaceWithUpdateCannotReinstallOrphanedSchedulerOverride', async () => {
  const serviceWatches = new RecoveryWatchService(new CountingRecoveryRuntime(), [])
  const compiler = new BlockingUpdateCompiler()
  const semantic = new RecoverySemanticWatchService(compiler, serviceWatches)
  const created = await semantic.create('Watch payments')

  const update = semantic.update(created.watchId, 'Watch payments every minute')
  assert.equal(compiler.calls, 2)
  semantic.remove(created.watchId)
  assert.equal(semantic.list().length, 0)
  assert.equal(serviceWatches.listStates().length, 0)

  compiler.release({ ...paymentsProposal, intervalSeconds: 60, rationale: 'One-minute watch.' })
  await assert.rejects(update, /Unknown semantic recovery watch/)
  assert.equal(semantic.list().length, 0)
  assert.equal(serviceWatches.listStates().length, 0)
})
