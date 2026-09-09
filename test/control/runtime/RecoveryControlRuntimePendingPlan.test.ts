import assert from 'node:assert/strict'
import test from 'node:test'

import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { FakeRecoveryPlanner } from '../../fake/FakeRecoveryPlanner.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

test('pendingPlanSuppressesRepeatedRecoveryAndPreventsRestartStorm', async () => {
  const token = 'test-token-1234567890'
  const nodeRuntime = new DemoNodeServiceRuntime('node-a', [
    { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: false },
  ])
  const server = new NodeAgentHttpServer(nodeRuntime, token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'payments', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 1 }
  const graph = buildRecoveryTestGraph(
    [gateway],
    [policy],
    new FakeRecoveryInvestigator(),
    new FakeRecoveryPlanner({ action: 'restart_service', rationale: 'One approved restart is evidence-supported.' }),
  )

  try {
    const first = await graph.control.recoverService('node-a', 'payments')
    assert.equal(first.status, 'approval_required')
    assert.equal(first.snapshot.restartCount, 1)
    assert.equal(graph.control.listIncidents().length, 1)
    assert.equal(graph.control.listRecoveryPlans().length, 1)

    const second = await graph.control.recoverService('node-a', 'payments')
    assert.equal(second.status, 'approval_required')
    assert.equal(second.restartAttempts, 0)
    assert.equal(second.snapshot.restartCount, 1)
    assert.equal(second.incident?.id, first.incident?.id)
    assert.equal(second.recoveryPlan?.id, first.recoveryPlan?.id)
    assert.equal(graph.control.listIncidents().length, 1)
    assert.equal(graph.control.listRecoveryPlans().length, 1)
  } finally {
    await graph.control.close()
    await server.close()
  }
})

test('externalRecoverySupersedesPendingPlanWithoutExecutingIt', async () => {
  const token = 'test-token-1234567890'
  const nodeRuntime = new DemoNodeServiceRuntime('node-a', [
    { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
  ])
  const server = new NodeAgentHttpServer(nodeRuntime, token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'payments', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 0 }
  const graph = buildRecoveryTestGraph(
    [gateway],
    [policy],
    new FakeRecoveryInvestigator(),
    new FakeRecoveryPlanner({ action: 'restart_service', rationale: 'One approved restart is evidence-supported.' }),
  )

  try {
    const pending = await graph.control.recoverService('node-a', 'payments')
    assert.equal(pending.status, 'approval_required')
    assert.equal(pending.snapshot.restartCount, 0)

    await nodeRuntime.restartService('payments')

    const reconciled = await graph.control.recoverService('node-a', 'payments')
    assert.equal(reconciled.status, 'healthy')
    assert.equal(reconciled.snapshot.restartCount, 1)
    assert.equal(reconciled.recoveryPlan?.status, 'superseded')
    assert.match(reconciled.recoveryPlan?.outcome ?? '', /recovered before approval/)
    assert.equal(reconciled.incident?.status, 'resolved')
    assert.match(reconciled.incident?.timeline.at(-1)?.message ?? '', /superseded without execution/)
  } finally {
    await graph.control.close()
    await server.close()
  }
})
