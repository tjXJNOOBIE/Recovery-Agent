import assert from 'node:assert/strict'
import test from 'node:test'

import type { RecoveryReadinessReport } from '../../../../src/control/readiness/RecoveryReadiness.js'
import { RecoveryReadinessWatchService } from '../../../../src/control/watch/readiness/RecoveryReadinessWatchService.js'

class FakeReadinessRuntime {
  public calls = 0

  public async inspectRecoveryReadiness(): Promise<RecoveryReadinessReport> {
    this.calls += 1
    return {
      observedAt: '2026-09-08T10:00:00.000Z',
      services: [],
      readyServices: 0,
      limitedServices: 0,
      blockedServices: 0,
      unreachableServices: 0,
    }
  }
}

test('runsRecoveryReadinessPeriodicallyWithoutMutatingRecoveryState', async () => {
  const runtime = new FakeReadinessRuntime()
  const watch = new RecoveryReadinessWatchService(runtime, 300_000)

  const first = await watch.runDueWatch(1_000_000)
  assert.equal(first.lastStatus, 'completed')
  assert.equal(runtime.calls, 1)

  const early = await watch.runDueWatch(1_299_999)
  assert.equal(early.lastStatus, 'completed')
  assert.equal(runtime.calls, 1)

  const due = await watch.runDueWatch(1_300_000)
  assert.equal(due.lastStatus, 'completed')
  assert.equal(runtime.calls, 2)
  assert.equal(due.report?.readyServices, 0)
})
