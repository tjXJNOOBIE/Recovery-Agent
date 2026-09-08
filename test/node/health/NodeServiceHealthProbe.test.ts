import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { NodeServiceHealthProbe } from '../../../src/node/health/NodeServiceHealthProbe.js'

test('probesConfiguredHttpAndTcpTargetsWithoutCallerSuppliedOperations', async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 204
    response.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const port = address.port
  const probe = new NodeServiceHealthProbe()

  try {
    const http = await probe.check({
      type: 'http',
      url: `http://127.0.0.1:${port}/health`,
      timeoutMs: 1000,
      expectedStatusCodes: [204],
    })
    assert.equal(http.healthy, true)
    assert.equal(http.statusCode, 204)
    assert.equal(http.type, 'http')

    const tcp = await probe.check({
      type: 'tcp',
      host: '127.0.0.1',
      port,
      timeoutMs: 1000,
    })
    assert.equal(tcp.healthy, true)
    assert.equal(tcp.type, 'tcp')

    const wrongStatus = await probe.check({
      type: 'http',
      url: `http://127.0.0.1:${port}/health`,
      timeoutMs: 1000,
      expectedStatusCodes: [200],
    })
    assert.equal(wrongStatus.healthy, false)
    assert.match(wrongStatus.detail, /expected 200/)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error))
    })
  }
})
