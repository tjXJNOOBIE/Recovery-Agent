import assert from 'node:assert/strict'
import test from 'node:test'

import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'

test('servesTypedInspectRestartAndVerifyOverHttpBoundary', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)

  try {
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
