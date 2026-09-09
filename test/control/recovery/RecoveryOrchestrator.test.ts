import assert from 'node:assert/strict'
import test from 'node:test'

import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { FakeRecoveryPlanner } from '../../fake/FakeRecoveryPlanner.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

test('recoversStoppedServiceDeterministicallyAndVerifiesHealth', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'worker', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 2 }
  const investigator = new FakeRecoveryInvestigator()
  const graph = buildRecoveryTestGraph([gateway], [policy], investigator)

  try {
    const result = await graph.orchestrator.recover(gateway, policy)
    assert.equal(result.status, 'recovered')
    assert.equal(result.restartAttempts, 1)
    assert.equal(result.snapshot.healthy, true)
    assert.equal(investigator.calls, 0)
    assert.equal(result.incident?.status, 'resolved')
  } finally {
    await graph.control.close()
    await server.close()
  }
})

test('createsPendingApprovalPlanAfterRecoveryBudgetWithoutGivingAiMutationAuthority', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: false },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'payments', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 1 }
  const investigator = new FakeRecoveryInvestigator({ summary: 'deployment regression suspected', requiresHuman: true })
  const planner = new FakeRecoveryPlanner({ action: 'restart_service', rationale: 'One additional approved restart could test a transient failure.' })
  const graph = buildRecoveryTestGraph([gateway], [policy], investigator, planner)

  try {
    const result = await graph.orchestrator.recover(gateway, policy)
    assert.equal(result.status, 'approval_required')
    assert.equal(result.restartAttempts, 1)
    assert.equal(investigator.calls, 1)
    assert.equal(planner.calls, 1)
    assert.equal(result.incident?.status, 'approval_required')
    assert.equal(result.recoveryPlan?.status, 'pending_approval')
    assert.equal(result.recoveryPlan?.nodeId, 'node-a')
    assert.equal(result.recoveryPlan?.serviceId, 'payments')
    assert.match(result.investigationSummary ?? '', /deployment regression/)
  } finally {
    await graph.control.close()
    await server.close()
  }
})
