import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { RecoveryControlConfig } from '../../../src/config/RecoveryControlConfig.js'
import { RecoveryControlRuntimeBuilder } from '../../../src/control/runtime/RecoveryControlRuntimeBuilder.js'
import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { RecoveryControlTlsSessionServer } from '../../../src/node/transport/RecoveryControlTlsSessionServer.js'
import { RecoveryNodeOutboundTlsLifecycle } from '../../../src/node/transport/RecoveryNodeOutboundTlsLifecycle.js'
import { FakeStrandsAgentRuntime } from '../../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../../fake/FakeStrandsAgentRuntimeBootstrap.js'

const fixtureDirectory = process.env['RECOVERY_TLS_TEST_CERT_DIR']
const tlsTest = (name: string, body: () => Promise<void>): void => {
  test(name, { skip: fixtureDirectory === undefined ? 'RECOVERY_TLS_TEST_CERT_DIR is not configured' : false }, body)
}

function fixturePath(name: string): string {
  if (fixtureDirectory === undefined) throw new Error('RECOVERY_TLS_TEST_CERT_DIR is not configured')
  return join(fixtureDirectory, name)
}

function fixture(name: string): Buffer {
  return readFileSync(fixturePath(name))
}

function fingerprint(name: string): string {
  return new X509Certificate(fixture(name)).fingerprint256
}

function copyNodeMaterial(certificateName = 'node.crt', keyName = 'node.key'): { readonly certificateFile: string; readonly privateKeyFile: string; readonly authorityFile: string } {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-production-tls-'))
  const certificateFile = join(directory, 'node.crt')
  const privateKeyFile = join(directory, 'node.key')
  const authorityFile = join(directory, 'ca.crt')
  copyFileSync(fixturePath(certificateName), certificateFile)
  copyFileSync(fixturePath(keyName), privateKeyFile)
  copyFileSync(fixturePath('ca.crt'), authorityFile)
  if (process.platform !== 'win32') chmodSync(privateKeyFile, 0o600)
  return { certificateFile, privateKeyFile, authorityFile }
}

function controlConfig(fingerprints: readonly string[]): RecoveryControlConfig {
  return {
    transport: {
      mode: 'outbound_tls', listenHost: '127.0.0.1', listenPort: 7843,
      certificateFile: '/unused/control.crt', privateKeyFile: '/unused/control.key', clientCertificateAuthorityFile: '/unused/ca.crt',
      requestTimeoutMs: 2_000, enrollmentTimeoutMs: 2_000,
    },
    nodes: [{
      id: 'node-a',
      allowedCertificateFingerprints: fingerprints,
      services: [{
        id: 'worker', restartAllowed: true, maxRestartAttempts: 1,
        restartBudgetWindowSeconds: 600, watchEnabled: true, watchIntervalSeconds: 30, dependencies: [],
      }],
    }],
    approvalPrincipals: [],
  }
}

function runtimeBuilder(): RecoveryControlRuntimeBuilder {
  return new RecoveryControlRuntimeBuilder(new FakeStrandsAgentRuntimeBootstrap(new FakeStrandsAgentRuntime('{}')), {})
}

async function waitUntil(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Recovery production TLS state')
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

tlsTest('recoversThroughSessionGatewayThenReconnectsWithRotatedNodeCredentialFiles', async () => {
  const material = copyNodeMaterial()
  const server = new RecoveryControlTlsSessionServer({
    certificate: fixture('control.crt'),
    privateKey: fixture('control.key'),
    clientCertificateAuthority: fixture('ca.crt'),
    nodes: [{ nodeId: 'node-a', allowedCertificateFingerprints: [fingerprint('node.crt'), fingerprint('node-rotated.crt')] }],
    requestTimeoutMs: 2_000,
    enrollmentTimeoutMs: 2_000,
  })
  const address = await server.listen()
  const nodeRuntime = new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ])
  const lifecycle = new RecoveryNodeOutboundTlsLifecycle({
    nodeId: 'node-a', host: address.host, port: address.port, serverName: 'control.test',
    certificateFile: material.certificateFile, privateKeyFile: material.privateKeyFile,
    controlCertificateAuthorityFile: material.authorityFile,
    allowedControlCertificateFingerprints: [fingerprint('control.crt')],
    enrollmentTimeoutMs: 2_000, reconnectInitialDelayMs: 10, reconnectMaximumDelayMs: 50,
  }, nodeRuntime)
  const control = runtimeBuilder().build(controlConfig([fingerprint('node.crt'), fingerprint('node-rotated.crt')]), [server.gateway('node-a')])

  try {
    lifecycle.start()
    await waitUntil(() => server.gateway('node-a').isConnected())

    const recovery = await control.recoverService('node-a', 'worker')
    assert.equal(recovery.status, 'recovered')
    assert.equal(recovery.restartAttempts, 1)
    assert.equal(recovery.snapshot.healthy, true)

    copyFileSync(fixturePath('node-rotated.crt'), material.certificateFile)
    copyFileSync(fixturePath('node-rotated.key'), material.privateKeyFile)
    if (process.platform !== 'win32') chmodSync(material.privateKeyFile, 0o600)

    await server.gateway('node-a').close()
    await waitUntil(() => server.gateway('node-a').isConnected())
    const afterReconnect = await control.inspectService('node-a', 'worker')
    assert.equal(afterReconnect.healthy, true)
    assert.equal(afterReconnect.restartCount, 1)
  } finally {
    await lifecycle.close()
    await control.close()
    await server.close()
  }
})

tlsTest('retiredNodeCredentialFailsClosedUntilLifecycleReloadsAllowedRotatedFiles', async () => {
  const material = copyNodeMaterial()
  const server = new RecoveryControlTlsSessionServer({
    certificate: fixture('control.crt'),
    privateKey: fixture('control.key'),
    clientCertificateAuthority: fixture('ca.crt'),
    nodes: [{ nodeId: 'node-a', allowedCertificateFingerprints: [fingerprint('node-rotated.crt')] }],
    enrollmentTimeoutMs: 1_000,
  })
  const address = await server.listen()
  let failures = 0
  const lifecycle = new RecoveryNodeOutboundTlsLifecycle({
    nodeId: 'node-a', host: address.host, port: address.port, serverName: 'control.test',
    certificateFile: material.certificateFile, privateKeyFile: material.privateKeyFile,
    controlCertificateAuthorityFile: material.authorityFile,
    allowedControlCertificateFingerprints: [fingerprint('control.crt')],
    enrollmentTimeoutMs: 1_000, reconnectInitialDelayMs: 20, reconnectMaximumDelayMs: 40,
    onFailure: () => { failures += 1 },
  }, new DemoNodeServiceRuntime('node-a', [{ id: 'worker', lifecycleState: 'running', healthy: true, restartRestoresHealth: true }]))

  try {
    lifecycle.start()
    await waitUntil(() => failures > 0)
    assert.equal(server.gateway('node-a').isConnected(), false)

    copyFileSync(fixturePath('node-rotated.crt'), material.certificateFile)
    copyFileSync(fixturePath('node-rotated.key'), material.privateKeyFile)
    if (process.platform !== 'win32') chmodSync(material.privateKeyFile, 0o600)

    await waitUntil(() => server.gateway('node-a').isConnected())
    assert.equal(server.gateway('node-a').isConnected(), true)
  } finally {
    await lifecycle.close()
    await server.close()
  }
})
