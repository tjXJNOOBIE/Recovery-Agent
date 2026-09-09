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

test('serializesExclusiveApprovedWorkAgainstAutomaticRecoveryForSameTarget', async () => {
  const gate = new RecoveryOperationGate()
  let releaseExclusive: (() => void) | undefined
  const sequence: string[] = []

  const exclusive = gate.runExclusive('node-a', 'payments', () => new Promise<string>((resolve) => {
    sequence.push('approval-started')
    releaseExclusive = () => {
      sequence.push('approval-finished')
      resolve('approved-result')
    }
  }))

  let recoveryCalls = 0
  const recovery = gate.run('node-a', 'payments', async () => {
    recoveryCalls += 1
    sequence.push('recovery-started')
    return healthyResult('payments')
  })

  assert.equal(recoveryCalls, 0)
  assert.deepEqual(sequence, ['approval-started'])
  assert.ok(releaseExclusive)
  releaseExclusive()

  assert.equal(await exclusive, 'approved-result')
  assert.equal((await recovery).status, 'healthy')
  assert.equal(recoveryCalls, 1)
  assert.deepEqual(sequence, ['approval-started', 'approval-finished', 'recovery-started'])
})

test('serializesExclusiveWorkQueuedBehindRecoveryAndReevaluatesAfterFailure', async () => {
  const gate = new RecoveryOperationGate()
  let rejectRecovery: ((error: Error) => void) | undefined
  const recovery = gate.run('node-a', 'payments', () => new Promise<RecoveryRunResult>((_resolve, reject) => {
    rejectRecovery = reject
  }))

  let exclusiveCalls = 0
  const exclusive = gate.runExclusive('node-a', 'payments', async () => {
    exclusiveCalls += 1
    return 'exclusive-after-failure'
  })
  assert.equal(exclusiveCalls, 0)

  assert.ok(rejectRecovery)
  rejectRecovery(new Error('recovery failed'))
  await assert.rejects(recovery, /recovery failed/)
  assert.equal(await exclusive, 'exclusive-after-failure')
  assert.equal(exclusiveCalls, 1)
})
