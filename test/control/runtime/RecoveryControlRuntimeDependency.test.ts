import assert from 'node:assert/strict'
import test from 'node:test'

import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

function policies() {
  return [
    {
      nodeId: 'node-a', serviceId: 'api', expectedState: 'running' as const,
      restartAllowed: true, maxRestartAttempts: 1,
      dependencies: [{ nodeId: 'node-a', serviceId: 'postgres' }],
    },
    {
      nodeId: 'node-a', serviceId: 'postgres', expectedState: 'running' as const,
      restartAllowed: true, maxRestartAttempts: 1,
    },
  ]
}

test('blocksDependentMutationUntilDeclaredDependencyRecovers', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'api', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
    { id: 'postgres', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const investigator = new FakeRecoveryInvestigator()
  const graph = buildRecoveryTestGraph([gateway], policies(), investigator)

  try {
    const blocked = await graph.control.recoverService('node-a', 'api')
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.restartAttempts, 0)
    assert.equal(blocked.snapshot.restartCount, 0)
    assert.equal(blocked.incident?.status, 'dependency_blocked')
    assert.equal(investigator.calls, 0)

    const dependency = await graph.control.recoverService('node-a', 'postgres')
    assert.equal(dependency.status, 'recovered')

    const recovered = await graph.control.recoverService('node-a', 'api')
    assert.equal(recovered.status, 'recovered')
    assert.equal(recovered.snapshot.restartCount, 1)
    const blockedIncident = graph.control.listIncidents().find((incident) => incident.id === blocked.incident?.id)
    assert.equal(blockedIncident?.status, 'resolved')
    assert.match(blockedIncident?.timeline.at(-1)?.message ?? '', /dependency block cleared/)
  } finally {
    await graph.control.close()
    await server.close()
  }
})

test('healthSweepRecoversDependenciesBeforeDependentsEvenWhenPolicyOrderIsReversed', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'api', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
    { id: 'postgres', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const graph = buildRecoveryTestGraph([gateway], policies(), new FakeRecoveryInvestigator())

  try {
    const results = await graph.control.healthSweep()
    assert.deepEqual(results.map((result) => result.snapshot.serviceId), ['postgres', 'api'])
    assert.deepEqual(results.map((result) => result.status), ['recovered', 'recovered'])
  } finally {
    await graph.control.close()
    await server.close()
  }
})
