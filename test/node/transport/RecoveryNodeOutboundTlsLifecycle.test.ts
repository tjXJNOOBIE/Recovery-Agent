import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  RecoveryNodeOutboundTlsLifecycle,
  type RecoveryOutboundTlsSessionHandle,
} from '../../../src/node/transport/RecoveryNodeOutboundTlsLifecycle.js'
import type { INodeServiceRuntime } from '../../../src/node/runtime/INodeServiceRuntime.js'
import type { ServiceSnapshot } from '../../../src/node/data/ServiceSnapshot.js'
import type { ServiceActionResult } from '../../../src/node/data/ServiceActionResult.js'

class UnusedRuntime implements INodeServiceRuntime {
  public readonly nodeId = 'node-a'
  public listServices(): Promise<readonly ServiceSnapshot[]> { return Promise.reject(new Error('unused')) }
  public inspectService(_serviceId: string): Promise<ServiceSnapshot> { return Promise.reject(new Error('unused')) }
  public restartService(_serviceId: string): Promise<ServiceActionResult> { return Promise.reject(new Error('unused')) }
}

class ConnectedFakeSession implements RecoveryOutboundTlsSessionHandle {
  private resolveDisconnect: (() => void) | undefined
  private readonly disconnected = new Promise<void>((resolve) => { this.resolveDisconnect = resolve })

  public async connect(): Promise<void> {}
  public waitForDisconnect(): Promise<void> { return this.disconnected }
  public async close(): Promise<void> { this.resolveDisconnect?.() }
}

function materialPaths(): { readonly certificate: string; readonly privateKey: string; readonly authority: string } {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-tls-lifecycle-'))
  const certificate = join(directory, 'node.crt')
  const privateKey = join(directory, 'node.key')
  const authority = join(directory, 'ca.crt')
  writeFileSync(certificate, 'certificate-one')
  writeFileSync(privateKey, 'private-key')
  writeFileSync(authority, 'authority')
  if (process.platform !== 'win32') chmodSync(privateKey, 0o600)
  return { certificate, privateKey, authority }
}

async function until(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
}

test('reloadsTlsMaterialOnReconnectAttempt', async () => {
  const paths = materialPaths()
  const seenCertificates: string[] = []
  let attempt = 0
  const lifecycle = new RecoveryNodeOutboundTlsLifecycle({
    nodeId: 'node-a', host: 'control.test', port: 7843, serverName: 'control.test',
    certificateFile: paths.certificate, privateKeyFile: paths.privateKey, controlCertificateAuthorityFile: paths.authority,
    allowedControlCertificateFingerprints: ['AA:BB'], reconnectInitialDelayMs: 1, reconnectMaximumDelayMs: 2,
  }, new UnusedRuntime(), undefined, undefined, undefined, (material) => {
    attempt += 1
    seenCertificates.push(material.certificate.toString())
    if (attempt === 1) {
      writeFileSync(paths.certificate, 'certificate-two')
      return {
        connect: () => Promise.reject(new Error('first connection failed')),
        waitForDisconnect: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }
    }
    return new ConnectedFakeSession()
  })

  lifecycle.start()
  await until(() => seenCertificates.length >= 2)
  assert.deepEqual(seenCertificates.slice(0, 2), ['certificate-one', 'certificate-two'])
  await lifecycle.close()
})

test('closeInterruptsLongReconnectDelay', async () => {
  const paths = materialPaths()
  let observedFailure: (() => void) | undefined
  const failed = new Promise<void>((resolve) => { observedFailure = resolve })
  const lifecycle = new RecoveryNodeOutboundTlsLifecycle({
    nodeId: 'node-a', host: 'control.test', port: 7843, serverName: 'control.test',
    certificateFile: paths.certificate, privateKeyFile: paths.privateKey, controlCertificateAuthorityFile: paths.authority,
    allowedControlCertificateFingerprints: ['AA:BB'], reconnectInitialDelayMs: 10_000, reconnectMaximumDelayMs: 10_000,
    onFailure: () => observedFailure?.(),
  }, new UnusedRuntime(), undefined, undefined, undefined, () => ({
    connect: () => Promise.reject(new Error('offline')),
    waitForDisconnect: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }))

  lifecycle.start()
  await failed
  await Promise.race([
    lifecycle.close(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('shutdown did not interrupt reconnect delay')), 250)),
  ])
})

test('rejectsReconnectMaximumBelowInitialDelay', () => {
  const paths = materialPaths()
  assert.throws(() => new RecoveryNodeOutboundTlsLifecycle({
    nodeId: 'node-a', host: 'control.test', port: 7843, serverName: 'control.test',
    certificateFile: paths.certificate, privateKeyFile: paths.privateKey, controlCertificateAuthorityFile: paths.authority,
    allowedControlCertificateFingerprints: ['AA:BB'], reconnectInitialDelayMs: 100, reconnectMaximumDelayMs: 99,
  }, new UnusedRuntime()), /maximum delay/)
})
