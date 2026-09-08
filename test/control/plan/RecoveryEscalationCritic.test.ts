import assert from 'node:assert/strict'
import test from 'node:test'

import { InMemoryIncidentRepository } from '../../../src/control/incident/repository/InMemoryIncidentRepository.js'
import type { IRecoveryPlanCritic, RecoveryPlanReview } from '../../../src/control/plan/IRecoveryPlanCritic.js'
import type { RecoveryPlanningRequest } from '../../../src/control/plan/IRecoveryPlanner.js'
import { InMemoryRecoveryPlanRepository } from '../../../src/control/plan/InMemoryRecoveryPlanRepository.js'
import { RecoveryEscalationHandler } from '../../../src/control/plan/RecoveryEscalationHandler.js'
import type { RecoveryPlanProposal } from '../../../src/control/plan/RecoveryPlan.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { FakeRecoveryPlanner } from '../../fake/FakeRecoveryPlanner.js'

class RejectingCritic implements IRecoveryPlanCritic {
  public calls = 0
  public async review(_request: RecoveryPlanningRequest, _proposal: RecoveryPlanProposal): Promise<RecoveryPlanReview> {
    this.calls += 1
    return { accepted: false, concerns: ['Recent deployment correlation is unresolved'] }
  }
}

const snapshot = { nodeId: 'node-a', serviceId: 'payments', lifecycleState: 'failed' as const, healthy: false, detail: 'failed', observedAt: '2026-09-08T00:00:00.000Z', restartCount: 2 }

test('criticRejectionCreatesNoPlanAndEscalatesToHuman', async () => {
  const incidents = new InMemoryIncidentRepository()
  const plans = new InMemoryRecoveryPlanRepository()
  const incident = incidents.open('node-a', 'payments', 'unhealthy')
  const critic = new RejectingCritic()
  const handler = new RecoveryEscalationHandler(
    incidents,
    new FakeRecoveryInvestigator({ summary: 'Possible deployment regression', requiresHuman: true }),
    new FakeRecoveryPlanner({ action: 'restart_service', rationale: 'One more restart' }),
    plans,
    critic,
  )

  const result = await handler.investigateAndPlan({ incident, before: snapshot, afterAttempts: snapshot, attempts: 2 })
  assert.equal(critic.calls, 1)
  assert.equal(result.plan, undefined)
  assert.equal(plans.list().length, 0)
  assert.equal(result.incident.status, 'human_required')
  assert.ok(result.incident.timeline.some((entry) => entry.kind === 'plan_review' && /rejected/i.test(entry.message)))
})
