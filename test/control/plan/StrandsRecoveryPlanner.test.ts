import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAgentRuntimeConfigBuilder } from '../../../src/agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryPlanProposalParser } from '../../../src/control/plan/RecoveryPlanProposalParser.js'
import { StrandsRecoveryPlanner } from '../../../src/control/plan/StrandsRecoveryPlanner.js'
import { FakeStrandsAgentRuntime } from '../../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../../fake/FakeStrandsAgentRuntimeBootstrap.js'

const planningRequest = {
  incident: {
    id: 'incident-1',
    nodeId: 'node-a',
    serviceId: 'payments',
    openedAt: '2026-09-08T00:00:00.000Z',
    status: 'recovering' as const,
    timeline: [],
  },
  before: {
    nodeId: 'node-a', serviceId: 'payments', lifecycleState: 'failed' as const,
    healthy: false, detail: 'failed', observedAt: '2026-09-08T00:00:00.000Z', restartCount: 1,
  },
  afterAttempts: {
    nodeId: 'node-a', serviceId: 'payments', lifecycleState: 'failed' as const,
    healthy: false, detail: 'still failed', observedAt: '2026-09-08T00:00:01.000Z', restartCount: 1,
  },
  attempts: 1,
  investigationSummary: 'deployment regression suspected',
}

test('parsesBoundedStrandsProposalAndClosesRuntime', async () => {
  const runtime = new FakeStrandsAgentRuntime('{"action":"restart_service","rationale":"One approved restart may distinguish transient failure."}')
  const planner = new StrandsRecoveryPlanner(
    new FakeStrandsAgentRuntimeBootstrap(runtime),
    new RecoveryAgentRuntimeConfigBuilder({}),
    new RecoveryPlanProposalParser(),
  )

  const proposal = await planner.plan(planningRequest)

  assert.equal(proposal.action, 'restart_service')
  assert.equal(runtime.invokeCalls, 1)
  assert.equal(runtime.closeCalls, 1)
  assert.match(String(runtime.lastInvokeArgs), /cannot be changed/)
})

test('closesRuntimeWhenStrandsReturnsUnsafeProposalShape', async () => {
  const runtime = new FakeStrandsAgentRuntime('{"action":"restart_service","rationale":"bad","serviceId":"other"}')
  const planner = new StrandsRecoveryPlanner(
    new FakeStrandsAgentRuntimeBootstrap(runtime),
    new RecoveryAgentRuntimeConfigBuilder({}),
    new RecoveryPlanProposalParser(),
  )

  await assert.rejects(planner.plan(planningRequest), /may contain only action and rationale/)
  assert.equal(runtime.closeCalls, 1)
})
