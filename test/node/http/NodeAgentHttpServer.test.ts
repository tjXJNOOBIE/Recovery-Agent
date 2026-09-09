import assert from 'node:assert/strict'
import test from 'node:test'

import type { NodeResourceSnapshot } from '../../../src/node/data/NodeResourceSnapshot.js'
import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'

const resources: NodeResourceSnapshot = {
  observedAt: '2026-09-08T00:00:00.000Z', uptimeSeconds: 100,
  loadAverage1mPerCpu: 0.25,
  memoryTotalBytes: 1000, memoryAvailableBytes: 500, memoryUsedPercent: 50,
  swapTotalBytes: 0, swapFreeBytes: 0, swapUsedPercent: 0,
  rootFilesystemTotalBytes: 1000, rootFilesystemAvailableBytes: 500, rootFilesystemUsedPercent: 50,
}

test('servesTypedInspectRestartAndVerifyOverHttpBoundary', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ]), token, { inspect: async () => resources })
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)

  try {
    const node = await gateway.inspectNode()
    assert.deepEqual(node.resources, resources)
    const before = await gateway.inspectService('worker')
    assert.equal(before.healthy, false)
    const action = await gateway.restartService('worker')
    assert.equal(action.accepted, true)
    const after = await gateway.inspectService('worker')
    assert.equal(after.lifecycleState, 'running')
    assert.equal(after.healthy, true)
    assert.equal(after.restartCount, 1)
  } finally {
    await gateway.close()
    await server.close()
  }
})
