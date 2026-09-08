import assert from 'node:assert/strict'
import test from 'node:test'

import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

test('explicitApprovalStillRefusesRestartWhenDeclaredDependencyIsUnhealthy', async () => {
  const token = 'test-token-1234567890'
  const approvalToken = 'approval-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'api', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
    { id: 'postgres', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policies = [
    {
      nodeId: 'node-a', serviceId: 'api', expectedState: 'running' as const,
      restartAllowed: true, maxRestartAttempts: 0,
      dependencies: [{ nodeId: 'node-a', serviceId: 'postgres' }],
    },
    { nodeId: 'node-a', serviceId: 'postgres', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 1 },
  ]
  const graph = buildRecoveryTestGraph([gateway], policies, new FakeRecoveryInvestigator(), undefined, approvalToken)

  try {
    const incident = graph.incidents.open('node-a', 'api', 'manual approval dependency test')
    const plan = graph.plans.create({
      incidentId: incident.id,
      nodeId: 'node-a',
      serviceId: 'api',
      rationale: 'test dependency gate',
    })

    await assert.rejects(graph.planControl.approve(plan.id, approvalToken), /blocked by unhealthy dependencies: node-a\/postgres/)
    assert.equal((await gateway.inspectService('api')).restartCount, 0)
    assert.equal(graph.plans.require(plan.id).status, 'failed')
    assert.equal(graph.incidents.require(incident.id).status, 'human_required')
  } finally {
    await graph.control.close()
    await server.close()
  }
})
