import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { RecoveryControlTlsSessionServer } from '../../../src/node/transport/RecoveryControlTlsSessionServer.js'
import { RecoveryNodeOutboundTlsSession } from '../../../src/node/transport/RecoveryNodeOutboundTlsSession.js'

const fixtureDirectory = process.env['RECOVERY_TLS_TEST_CERT_DIR']
const tlsTest = (name: string, body: () => Promise<void>): void => {
  test(name, { skip: fixtureDirectory === undefined ? 'RECOVERY_TLS_TEST_CERT_DIR is not configured' : false }, body)
}

function fixture(name: string): Buffer {
  if (fixtureDirectory === undefined) throw new Error('RECOVERY_TLS_TEST_CERT_DIR is not configured')
  return readFileSync(join(fixtureDirectory, name))
}

function fingerprint(name: string): string {
  return new X509Certificate(fixture(name)).fingerprint256
}

function runtime(): DemoNodeServiceRuntime {
  return new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ])
}

tlsTest('runsTypedRecoveryOperationsOverOutboundMutualTlsSession', async () => {
  const server = new RecoveryControlTlsSessionServer({
    certificate: fixture('control.crt'),
    privateKey: fixture('control.key'),
    clientCertificateAuthority: fixture('ca.crt'),
    nodes: [{ nodeId: 'node-a', allowedCertificateFingerprints: [fingerprint('node.crt')] }],
  })
  const address = await server.listen()
  const node = new RecoveryNodeOutboundTlsSession({
    nodeId: 'node-a',
    host: address.host,
    port: address.port,
    serverName: 'control.test',
    certificate: fixture('node.crt'),
    privateKey: fixture('node.key'),
    controlCertificateAuthority: fixture('ca.crt'),
    allowedControlCertificateFingerprints: [fingerprint('control.crt')],
  }, runtime())

  try {
    await node.connect()
    const gateway = server.gateway('node-a')
    assert.equal(gateway.isConnected(), true)
    const before = await gateway.inspectService('worker')
    assert.equal(before.healthy, false)
    const action = await gateway.restartService('worker')
    assert.equal(action.accepted, true)
    const after = await gateway.inspectService('worker')
    assert.equal(after.healthy, true)
    assert.equal(after.restartCount, 1)
  } finally {
    await node.close()
    await server.close()
  }
})

tlsTest('rejectsCaValidNodeCertificateWhenFingerprintIsNotBoundToClaimedNode', async () => {
  const server = new RecoveryControlTlsSessionServer({
    certificate: fixture('control.crt'),
    privateKey: fixture('control.key'),
    clientCertificateAuthority: fixture('ca.crt'),
    nodes: [{ nodeId: 'node-a', allowedCertificateFingerprints: [fingerprint('node.crt')] }],
    enrollmentTimeoutMs: 2_000,
  })
  const address = await server.listen()
  const node = new RecoveryNodeOutboundTlsSession({
    nodeId: 'node-a',
    host: address.host,
    port: address.port,
    serverName: 'control.test',
    certificate: fixture('node-rotated.crt'),
    privateKey: fixture('node-rotated.key'),
    controlCertificateAuthority: fixture('ca.crt'),
    allowedControlCertificateFingerprints: [fingerprint('control.crt')],
    enrollmentTimeoutMs: 2_000,
  }, runtime())

  try {
    await assert.rejects(node.connect(), /closed before enrollment acknowledgement|not allowed|enrollment timed out/)
    assert.equal(server.gateway('node-a').isConnected(), false)
  } finally {
    await node.close()
    await server.close()
  }
})

tlsTest('rejectsControlCertificateWhenNodePinDoesNotMatch', async () => {
  const server = new RecoveryControlTlsSessionServer({
    certificate: fixture('control.crt'),
    privateKey: fixture('control.key'),
    clientCertificateAuthority: fixture('ca.crt'),
    nodes: [{ nodeId: 'node-a', allowedCertificateFingerprints: [fingerprint('node.crt')] }],
  })
  const address = await server.listen()
  const node = new RecoveryNodeOutboundTlsSession({
    nodeId: 'node-a',
    host: address.host,
    port: address.port,
    serverName: 'control.test',
    certificate: fixture('node.crt'),
    privateKey: fixture('node.key'),
    controlCertificateAuthority: fixture('ca.crt'),
    allowedControlCertificateFingerprints: [fingerprint('node-rotated.crt')],
    enrollmentTimeoutMs: 2_000,
  }, runtime())

  try {
    await assert.rejects(node.connect(), /Recovery control host certificate fingerprint is not allowed/)
    assert.equal(server.gateway('node-a').isConnected(), false)
  } finally {
    await node.close()
    await server.close()
  }
})

tlsTest('acceptsOldAndRotatedNodeCertificatesDuringExplicitOverlap', async () => {
  const server = new RecoveryControlTlsSessionServer({
    certificate: fixture('control.crt'),
    privateKey: fixture('control.key'),
    clientCertificateAuthority: fixture('ca.crt'),
    nodes: [{ nodeId: 'node-a', allowedCertificateFingerprints: [fingerprint('node.crt'), fingerprint('node-rotated.crt')] }],
  })
  const address = await server.listen()
  const first = new RecoveryNodeOutboundTlsSession({
    nodeId: 'node-a', host: address.host, port: address.port, serverName: 'control.test',
    certificate: fixture('node.crt'), privateKey: fixture('node.key'), controlCertificateAuthority: fixture('ca.crt'),
    allowedControlCertificateFingerprints: [fingerprint('control.crt')],
  }, runtime())
  const rotated = new RecoveryNodeOutboundTlsSession({
    nodeId: 'node-a', host: address.host, port: address.port, serverName: 'control.test',
    certificate: fixture('node-rotated.crt'), privateKey: fixture('node-rotated.key'), controlCertificateAuthority: fixture('ca.crt'),
    allowedControlCertificateFingerprints: [fingerprint('control.crt')],
  }, runtime())

  try {
    await first.connect()
    assert.equal(server.gateway('node-a').isConnected(), true)
    await first.close()
    await waitUntil(() => !server.gateway('node-a').isConnected())
    await rotated.connect()
    assert.equal(server.gateway('node-a').isConnected(), true)
  } finally {
    await first.close()
    await rotated.close()
    await server.close()
  }
})

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for Recovery TLS session state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
