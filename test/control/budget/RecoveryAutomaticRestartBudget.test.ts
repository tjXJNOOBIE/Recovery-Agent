import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAutomaticRestartBudget } from '../../../src/control/budget/RecoveryAutomaticRestartBudget.js'
import type { ServiceRecoveryPolicy } from '../../../src/control/policy/ServiceRecoveryPolicy.js'

function policy(serviceId = 'payments'): ServiceRecoveryPolicy {
  return {
    nodeId: 'node-a',
    serviceId,
    expectedState: 'running',
    restartAllowed: true,
    maxRestartAttempts: 2,
    restartBudgetWindowMs: 1_000,
  }
}

test('enforcesRollingRestartCeilingAndReleasesExpiredAttempts', () => {
  let nowMs = 0
  const budget = new RecoveryAutomaticRestartBudget(() => nowMs)
  const recoveryPolicy = policy()

  assert.equal(budget.tryConsume(recoveryPolicy).allowed, true)
  nowMs = 100
  assert.equal(budget.tryConsume(recoveryPolicy).allowed, true)
  nowMs = 999
  const exhausted = budget.tryConsume(recoveryPolicy)
  assert.equal(exhausted.allowed, false)
  assert.equal(exhausted.snapshot.usedAttempts, 2)
  assert.equal(exhausted.snapshot.remainingAttempts, 0)

  nowMs = 1_001
  const released = budget.tryConsume(recoveryPolicy)
  assert.equal(released.allowed, true)
  assert.equal(released.snapshot.usedAttempts, 2)
  assert.equal(released.snapshot.remainingAttempts, 0)
})

test('keepsAutomaticRestartBudgetsIndependentPerServiceTarget', () => {
  const budget = new RecoveryAutomaticRestartBudget(() => 10)
  assert.equal(budget.tryConsume(policy('payments')).allowed, true)
  assert.equal(budget.tryConsume(policy('payments')).allowed, true)
  assert.equal(budget.tryConsume(policy('payments')).allowed, false)
  assert.equal(budget.tryConsume(policy('worker')).allowed, true)
})
