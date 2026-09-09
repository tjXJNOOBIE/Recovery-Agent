import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryOperationGate } from '../../../src/control/recovery/RecoveryOperationGate.js'
import type { RecoveryRunResult } from '../../../src/control/recovery/RecoveryRunResult.js'

function healthyResult(serviceId: string): RecoveryRunResult {
  return {
    status: 'healthy',
    restartAttempts: 0,
    snapshot: {
      nodeId: 'node-a',
      serviceId,
      lifecycleState: 'running',
      healthy: true,
      detail: 'healthy',
      observedAt: '2026-09-08T00:00:00.000Z',
      restartCount: 0,
    },
  }
}

test('coalescesConcurrentRecoveryForSameTargetButNotDifferentTargets', async () => {
  const gate = new RecoveryOperationGate()
  let releaseFirst: ((result: RecoveryRunResult) => void) | undefined
  let firstCalls = 0
  const firstPromise = gate.run('node-a', 'payments', () => {
    firstCalls += 1
    return new Promise<RecoveryRunResult>((resolve) => { releaseFirst = resolve })
  })
  const duplicate = gate.run('node-a', 'payments', async () => {
    firstCalls += 1
    return healthyResult('payments')
  })
  const different = gate.run('node-a', 'worker', async () => healthyResult('worker'))

  assert.equal(firstCalls, 1)
  assert.equal(duplicate, firstPromise)
  assert.equal((await different).snapshot.serviceId, 'worker')

  assert.ok(releaseFirst)
  releaseFirst(healthyResult('payments'))
  assert.equal((await duplicate).snapshot.serviceId, 'payments')

  const afterCompletion = await gate.run('node-a', 'payments', async () => {
    firstCalls += 1
    return healthyResult('payments')
  })
  assert.equal(afterCompletion.status, 'healthy')
  assert.equal(firstCalls, 2)
})
