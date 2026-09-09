import assert from 'node:assert/strict'
import test from 'node:test'

import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { RecoveryCertificateFingerprintPolicy, normalizeRecoveryCertificateFingerprint } from '../../../src/node/transport/RecoveryCertificateFingerprintPolicy.js'
import { RecoveryNodeLineFramer } from '../../../src/node/transport/RecoveryNodeLineFramer.js'
import { RecoveryNodeRequestDispatcher } from '../../../src/node/transport/RecoveryNodeRequestDispatcher.js'

const NODE_FINGERPRINT = '22:AD:F7:67:D6:F0:57:49:97:A0:A3:10:AC:05:42:F4:4F:C3:B3:28:BF:E3:C1:D5:D7:EE:9E:EF:5C:48:C4:50'
const ROTATED_FINGERPRINT = 'A1:12:F0:2C:3B:AF:AB:7B:C3:43:C1:9C:74:E3:E7:AF:F8:CE:34:9B:5A:EF:EA:84:7C:00:A1:2C:23:3B:AE:1E'

test('framesSplitAndCoalescedProtocolLinesWithoutUnboundedBuffering', () => {
  const framer = new RecoveryNodeLineFramer(64)
  assert.deepEqual(framer.push(Buffer.from('{"a":1}\n{"b"')), ['{"a":1}'])
  assert.deepEqual(framer.push(Buffer.from(':2}\n{"c":3}\n')), ['{"b":2}', '{"c":3}'])
  framer.finish()

  const incomplete = new RecoveryNodeLineFramer(64)
  incomplete.push(Buffer.from('{"a":1}'))
  assert.throws(() => incomplete.finish(), /incomplete frame/)

  const oversized = new RecoveryNodeLineFramer(8)
  assert.throws(() => oversized.push(Buffer.from('123456789')), /exceeds 8 bytes/)
})

test('acceptsExplicitFingerprintOverlapForCredentialRotation', () => {
  const policy = new RecoveryCertificateFingerprintPolicy([NODE_FINGERPRINT, ROTATED_FINGERPRINT])
  assert.equal(policy.accepts(NODE_FINGERPRINT), true)
  assert.equal(policy.accepts(ROTATED_FINGERPRINT.toLowerCase().replaceAll(':', '')), true)
  assert.equal(normalizeRecoveryCertificateFingerprint(NODE_FINGERPRINT), NODE_FINGERPRINT.toLowerCase().replaceAll(':', ''))
  assert.throws(
    () => policy.requireAllowed('3a81ca375becdb572d238596a8e042fc7c0eaecb49e51a6c44185ce7beb3f996', 'node-a'),
    /not allowed/,
  )
  assert.throws(() => new RecoveryCertificateFingerprintPolicy([NODE_FINGERPRINT, NODE_FINGERPRINT]), /duplicates/)
  assert.throws(() => new RecoveryCertificateFingerprintPolicy([]), /must not be empty/)
})

test('dispatchesOnlyTypedProtocolOperationsToTheNodeRuntime', async () => {
  const runtime = new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ])
  const dispatcher = new RecoveryNodeRequestDispatcher(runtime)

  const before = await dispatcher.dispatch({ version: 1, type: 'request', id: 'inspect-1', operation: 'inspect_service', serviceId: 'worker' })
  assert.equal(before.ok, true)
  if (before.ok) assert.equal((before.result as { healthy: boolean }).healthy, false)

  const restarted = await dispatcher.dispatch({ version: 1, type: 'request', id: 'restart-1', operation: 'restart_service', serviceId: 'worker' })
  assert.equal(restarted.ok, true)

  const after = await dispatcher.dispatch({ version: 1, type: 'request', id: 'inspect-2', operation: 'inspect_service', serviceId: 'worker' })
  assert.equal(after.ok, true)
  if (after.ok) {
    const snapshot = after.result as { healthy: boolean; restartCount: number }
    assert.equal(snapshot.healthy, true)
    assert.equal(snapshot.restartCount, 1)
  }

  const missing = await dispatcher.dispatch({ version: 1, type: 'request', id: 'missing-1', operation: 'inspect_service', serviceId: 'does-not-exist' })
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.equal(missing.error.code, 'not_found')
})
