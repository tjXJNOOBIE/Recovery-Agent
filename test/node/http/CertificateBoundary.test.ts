import assert from 'node:assert/strict'
import test from 'node:test'

import type { INodeCertificateProbe } from '../../../src/node/certificate/NodeCertificateProbe.js'
import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'

class FakeCertificateProbe implements INodeCertificateProbe {
  public async listCertificates() {
    return [{
      nodeId: 'node-a', certificateId: 'public-tls', target: 'example.test:443', observedAt: '2026-09-08T00:00:00.000Z',
      reachable: true, authorized: true, warnBeforeDays: 30, criticalBeforeDays: 7, daysRemaining: 42,
    }]
  }
}

test('servesConfiguredCertificateEvidenceOverAuthenticatedNodeBoundary', async () => {
  const token = 'test-node-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', []), token, undefined, new FakeCertificateProbe())
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  try {
    const certificates = await gateway.inspectCertificates()
    assert.equal(certificates.length, 1)
    assert.equal(certificates[0]?.certificateId, 'public-tls')
    assert.equal(certificates[0]?.daysRemaining, 42)
  } finally {
    await gateway.close()
    await server.close()
  }
})
