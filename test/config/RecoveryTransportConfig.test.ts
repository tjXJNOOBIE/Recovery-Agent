import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RecoveryControlConfigReader } from '../../src/config/RecoveryControlConfig.js'
import { RecoveryNodeConfigReader } from '../../src/config/RecoveryNodeConfig.js'

const fingerprint = 'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA'

function writeConfig(name: string, value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-transport-config-'))
  const path = join(directory, name)
  writeFileSync(path, JSON.stringify(value))
  return path
}

function service(): unknown {
  return { id: 'worker', restartAllowed: true, maxRestartAttempts: 1 }
}

test('legacyControlTransportRemainsLoopbackOnlyAndRejectsRemotePlaintext', () => {
  const localPath = writeConfig('control-local.json', {
    nodes: [{ id: 'node-a', baseUrl: 'http://127.0.0.1:7843', tokenEnvironmentVariable: 'NODE_TOKEN', services: [service()] }],
  })
  const local = new RecoveryControlConfigReader().read(localPath)
  assert.deepEqual(local.transport, { mode: 'loopback_http' })
  assert.equal(local.nodes[0]?.baseUrl, 'http://127.0.0.1:7843/')

  const remotePath = writeConfig('control-remote.json', {
    nodes: [{ id: 'node-a', baseUrl: 'http://10.0.0.12:7843', tokenEnvironmentVariable: 'NODE_TOKEN', services: [service()] }],
  })
  assert.throws(() => new RecoveryControlConfigReader().read(remotePath), /must target localhost, 127\.0\.0\.1, or ::1/)
})

test('parsesOutboundTlsControlTransportAndRejectsBearerAmbiguity', () => {
  const path = writeConfig('control-tls.json', {
    transport: {
      mode: 'outbound_tls',
      listenHost: '0.0.0.0',
      listenPort: 9443,
      certificateFile: '/etc/recovery/control.crt',
      privateKeyFile: '/etc/recovery/control.key',
      clientCertificateAuthorityFile: '/etc/recovery/ca.crt',
    },
    nodes: [{ id: 'node-a', allowedCertificateFingerprints: [fingerprint], services: [service()] }],
  })
  const config = new RecoveryControlConfigReader().read(path)
  assert.equal(config.transport.mode, 'outbound_tls')
  assert.equal(config.nodes[0]?.allowedCertificateFingerprints[0], 'a'.repeat(64))
  assert.equal(config.nodes[0]?.baseUrl, undefined)
  assert.equal(config.nodes[0]?.tokenEnvironmentVariable, undefined)

  const ambiguous = writeConfig('control-tls-ambiguous.json', {
    transport: {
      mode: 'outbound_tls', certificateFile: '/x.crt', privateKeyFile: '/x.key', clientCertificateAuthorityFile: '/ca.crt',
    },
    nodes: [{ id: 'node-a', baseUrl: 'http://127.0.0.1:7843', allowedCertificateFingerprints: [fingerprint], services: [service()] }],
  })
  assert.throws(() => new RecoveryControlConfigReader().read(ambiguous), /must not configure baseUrl or tokenEnvironmentVariable/)
})

test('parsesOutboundTlsNodeTransportWithBoundedReconnectAndRejectsInboundFields', () => {
  const path = writeConfig('node-tls.json', {
    nodeId: 'node-a',
    transport: {
      mode: 'outbound_tls',
      host: 'control.example.test',
      port: 9443,
      serverName: 'control.example.test',
      certificateFile: '/etc/recovery/node.crt',
      privateKeyFile: '/etc/recovery/node.key',
      controlCertificateAuthorityFile: '/etc/recovery/ca.crt',
      allowedControlCertificateFingerprints: [fingerprint],
      reconnectInitialDelayMs: 250,
      reconnectMaximumDelayMs: 4_000,
    },
    services: [{ id: 'worker', unit: 'worker.service' }],
  })
  const config = new RecoveryNodeConfigReader().read(path)
  assert.equal(config.transport.mode, 'outbound_tls')
  if (config.transport.mode !== 'outbound_tls') throw new Error('expected outbound_tls transport')
  assert.equal(config.transport.reconnectInitialDelayMs, 250)
  assert.equal(config.transport.reconnectMaximumDelayMs, 4_000)
  assert.equal(config.transport.allowedControlCertificateFingerprints[0], 'a'.repeat(64))

  const ambiguous = writeConfig('node-tls-ambiguous.json', {
    nodeId: 'node-a',
    listenHost: '127.0.0.1',
    tokenEnvironmentVariable: 'NODE_TOKEN',
    transport: {
      mode: 'outbound_tls', host: 'control.test', port: 9443, certificateFile: '/x.crt', privateKeyFile: '/x.key',
      controlCertificateAuthorityFile: '/ca.crt', allowedControlCertificateFingerprints: [fingerprint],
    },
    services: [{ id: 'worker', unit: 'worker.service' }],
  })
  assert.throws(() => new RecoveryNodeConfigReader().read(ambiguous), /must not configure inbound listener or bearer-token fields/)
})

test('explicitLoopbackNodeTransportRejectsNonLoopbackListener', () => {
  const path = writeConfig('node-http.json', {
    nodeId: 'node-a',
    transport: { mode: 'loopback_http', listenHost: '0.0.0.0', tokenEnvironmentVariable: 'NODE_TOKEN' },
    services: [{ id: 'worker', unit: 'worker.service' }],
  })
  assert.throws(() => new RecoveryNodeConfigReader().read(path), /listenHost must be localhost, 127\.0\.0\.1, or ::1/)
})
