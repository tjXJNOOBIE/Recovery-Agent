import assert from 'node:assert/strict'
import test from 'node:test'

import type { ServiceActionResult } from '../../../src/node/data/ServiceActionResult.js'
import type { NodeSnapshot, ServiceSnapshot } from '../../../src/node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../../src/node/gateway/INodeAgentGateway.js'
import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

class OfflineGateway implements INodeAgentGateway {
  public readonly nodeId = 'offline-node'
  public async inspectNode(): Promise<NodeSnapshot> { throw new Error('connection refused') }
  public async inspectService(_serviceId: string): Promise<ServiceSnapshot> { throw new Error('connection refused') }
  public async restartService(_serviceId: string): Promise<ServiceActionResult> { throw new Error('connection refused') }
  public async close(): Promise<void> {}
}

test('offlineNodeDoesNotHideReachableFleetOrBlockHealthySweepWork', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('online-node', [
    { id: 'worker', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const online = new HttpNodeAgentGateway('online-node', address.baseUrl, token)
  const offline = new OfflineGateway()
  const policies = [
    { nodeId: 'online-node', serviceId: 'worker', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 1 },
    { nodeId: 'offline-node', serviceId: 'api', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 1 },
  ]
  const graph = buildRecoveryTestGraph([online, offline], policies, new FakeRecoveryInvestigator())

  try {
    const fleet = await graph.control.fleetStatus()
    assert.equal(fleet.nodes.length, 1)
    assert.equal(fleet.nodes[0]?.nodeId, 'online-node')
    assert.deepEqual(fleet.unreachableNodes, [{ nodeId: 'offline-node', error: 'connection refused' }])
    assert.equal(fleet.unhealthyServices, 1)

    const sweep = await graph.control.healthSweep()
    assert.equal(sweep.length, 1)
    assert.equal(sweep[0]?.snapshot.nodeId, 'online-node')
    assert.equal(sweep[0]?.status, 'recovered')
  } finally {
    await graph.control.close()
    await server.close()
  }
})
