import assert from 'node:assert/strict'
import test from 'node:test'

import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { FakeRecoveryPlanner } from '../../fake/FakeRecoveryPlanner.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

test('humanRequiredIncidentSuppressesRepeatedAutomaticRecovery', async () => {
  const token = 'test-token-1234567890'
  const nodeRuntime = new DemoNodeServiceRuntime('node-a', [
    { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: false },
  ])
  const server = new NodeAgentHttpServer(nodeRuntime, token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'payments', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 1 }
  const planner = new FakeRecoveryPlanner({ action: 'none', rationale: 'No safe automatic action remains.' })
  const graph = buildRecoveryTestGraph([gateway], [policy], new FakeRecoveryInvestigator(), planner)

  try {
    const first = await graph.control.recoverService('node-a', 'payments')
    assert.equal(first.status, 'escalated')
    assert.equal(first.snapshot.restartCount, 1)
    assert.equal(first.incident?.status, 'human_required')
    assert.equal(graph.control.listIncidents().length, 1)
    assert.equal(planner.calls, 1)

    const second = await graph.control.recoverService('node-a', 'payments')
    assert.equal(second.status, 'escalated')
    assert.equal(second.restartAttempts, 0)
    assert.equal(second.snapshot.restartCount, 1)
    assert.equal(second.incident?.id, first.incident?.id)
    assert.equal(graph.control.listIncidents().length, 1)
    assert.equal(planner.calls, 1)
  } finally {
    await graph.control.close()
    await server.close()
  }
})

test('externalRecoveryResolvesHumanRequiredIncidentWithoutAutomaticMutation', async () => {
  const token = 'test-token-1234567890'
  const nodeRuntime = new DemoNodeServiceRuntime('node-a', [
    { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
  ])
  const server = new NodeAgentHttpServer(nodeRuntime, token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'payments', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 0 }
  const planner = new FakeRecoveryPlanner({ action: 'none', rationale: 'No safe automatic action remains.' })
  const graph = buildRecoveryTestGraph([gateway], [policy], new FakeRecoveryInvestigator(), planner)

  try {
    const escalated = await graph.control.recoverService('node-a', 'payments')
    assert.equal(escalated.status, 'escalated')
    assert.equal(escalated.snapshot.restartCount, 0)
    assert.equal(escalated.incident?.status, 'human_required')

    await nodeRuntime.restartService('payments')

    const reconciled = await graph.control.recoverService('node-a', 'payments')
    assert.equal(reconciled.status, 'healthy')
    assert.equal(reconciled.restartAttempts, 0)
    assert.equal(reconciled.snapshot.restartCount, 1)
    assert.equal(reconciled.incident?.id, escalated.incident?.id)
    assert.equal(reconciled.incident?.status, 'resolved')
    assert.match(reconciled.incident?.timeline.at(-1)?.message ?? '', /no additional automatic recovery executed/)
    assert.equal(planner.calls, 1)
  } finally {
    await graph.control.close()
    await server.close()
  }
})
