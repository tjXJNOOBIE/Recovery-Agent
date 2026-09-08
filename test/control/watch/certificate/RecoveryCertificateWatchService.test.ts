import assert from 'node:assert/strict'
import test from 'node:test'

import type { CertificateSnapshot } from '../../../../src/node/certificate/CertificateSnapshot.js'
import { RecoveryCertificateWatchService } from '../../../../src/control/watch/certificate/RecoveryCertificateWatchService.js'

class FakeCertificateRuntime {
  public snapshots: readonly CertificateSnapshot[] = []
  public error: Error | undefined
  public async inspectCertificates(_nodeId: string): Promise<readonly CertificateSnapshot[]> {
    if (this.error !== undefined) throw this.error
    return this.snapshots
  }
}

function certificate(daysRemaining: number, authorized = true): CertificateSnapshot {
  return {
    nodeId: 'node-a', certificateId: 'public-tls', target: 'example.test:443', observedAt: '2026-09-08T00:00:00.000Z',
    reachable: true, authorized, warnBeforeDays: 30, criticalBeforeDays: 7, daysRemaining,
    ...(authorized ? {} : { authorizationError: 'self signed certificate' }),
  }
}

test('classifiesWarningCriticalAndRecoveryWithoutMutatingServices', async () => {
  const runtime = new FakeCertificateRuntime()
  const watch = new RecoveryCertificateWatchService(runtime, ['node-a'], 1)

  runtime.snapshots = [certificate(20)]
  let result = await watch.runNow(0)
  assert.equal(result[0]?.status, 'warning')
  const incidentId = result[0]?.incidentId
  assert.ok(incidentId)
  assert.equal(watch.listIncidents()[0]?.status, 'open')

  runtime.snapshots = [certificate(5)]
  result = await watch.runNow(1)
  assert.equal(result[0]?.status, 'critical')
  assert.equal(result[0]?.incidentId, incidentId)

  runtime.snapshots = [certificate(60)]
  result = await watch.runNow(2)
  assert.equal(result[0]?.status, 'healthy')
  assert.equal(watch.listIncidents()[0]?.status, 'resolved')
})

test('treatsAuthorizationFailureAsCriticalAndNodeInspectionFailureAsUnreachable', async () => {
  const runtime = new FakeCertificateRuntime()
  const watch = new RecoveryCertificateWatchService(runtime, ['node-a'], 1)

  runtime.snapshots = [certificate(200, false)]
  const unauthorized = await watch.runNow(0)
  assert.equal(unauthorized[0]?.status, 'critical')
  assert.match(unauthorized[0]?.snapshot?.authorizationError ?? '', /self signed/)

  runtime.error = new Error('connection refused')
  const unreachable = await watch.runNow(1)
  assert.equal(unreachable[0]?.status, 'unreachable')
  assert.equal(unreachable[0]?.certificateId, '__node_tls__')
})
