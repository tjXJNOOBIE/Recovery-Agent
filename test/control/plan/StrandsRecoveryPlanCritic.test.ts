import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAgentRuntimeConfigBuilder } from '../../../src/agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryPlanReviewParser } from '../../../src/control/plan/RecoveryPlanReviewParser.js'
import { StrandsRecoveryPlanCritic } from '../../../src/control/plan/StrandsRecoveryPlanCritic.js'
import { FakeStrandsAgentRuntime } from '../../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../../fake/FakeStrandsAgentRuntimeBootstrap.js'

const snapshot = { nodeId: 'node-a', serviceId: 'payments', lifecycleState: 'failed' as const, healthy: false, detail: 'failed', observedAt: '2026-09-08T00:00:00.000Z', restartCount: 1 }
const request = { incident: { id: 'incident-a', nodeId: 'node-a', serviceId: 'payments', openedAt: '2026-09-08T00:00:00.000Z', status: 'recovering' as const, timeline: [] }, before: snapshot, afterAttempts: snapshot, attempts: 1, investigationSummary: 'Deployment correlation remains unresolved.' }

test('criticCanOnlyAcceptOrRejectBoundedProposalAndClosesRuntime', async () => {
  const runtime = new FakeStrandsAgentRuntime('{"accepted":false,"concerns":["Deployment clue unresolved"]}')
  const critic = new StrandsRecoveryPlanCritic(new FakeStrandsAgentRuntimeBootstrap(runtime), new RecoveryAgentRuntimeConfigBuilder({}), new RecoveryPlanReviewParser())
  const review = await critic.review(request, { action: 'restart_service', rationale: 'Try once more' })
  assert.equal(review.accepted, false)
  assert.deepEqual(review.concerns, ['Deployment clue unresolved'])
  assert.match(String(runtime.lastInvokeArgs), /may only accept or reject/i)
  assert.equal(runtime.closeCalls, 1)
})
