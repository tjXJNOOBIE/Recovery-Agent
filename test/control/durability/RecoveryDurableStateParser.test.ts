import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RecoveryDurableStateParser,
  RecoveryStateAuthorityError,
  RecoveryStateStaleRevisionError,
} from '../../../src/control/durability/RecoveryDurableStateParser.js'

const parser = new RecoveryDurableStateParser()

function snapshot(): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    incidents: [{
      id: 'incident-1',
      nodeId: 'node-a',
      serviceId: 'payments',
      openedAt: '2026-09-08T19:00:00.000Z',
      status: 'resolved',
      timeline: [
        { at: '2026-09-08T19:00:00.000Z', kind: 'detected', message: 'unhealthy' },
        { at: '2026-09-08T19:01:00.000Z', kind: 'resolved', message: 'healthy' },
      ],
    }],
    plans: [{
      id: 'plan-1',
      incidentId: 'incident-1',
      nodeId: 'node-a',
      serviceId: 'payments',
      action: { type: 'restart_service' },
      rationale: 'one bounded restart',
      risk: 'elevated',
      status: 'executed',
      createdAt: '2026-09-08T19:00:30.000Z',
      updatedAt: '2026-09-08T19:01:00.000Z',
      outcome: 'restored health',
    }],
    semanticWatches: [{
      watchId: 'watch-1',
      request: 'watch payments every minute',
      nodeId: 'node-a',
      serviceId: 'payments',
      intervalMs: 60_000,
      rationale: 'operator requested recurring recovery',
      createdAt: '2026-09-08T18:00:00.000Z',
      updatedAt: '2026-09-08T18:00:00.000Z',
    }],
    restartAttempts: [{ nodeId: 'node-a', serviceId: 'payments', atMs: 1_789_000_000_000 }],
    audit: [{
      id: 'audit-1',
      at: '2026-09-08T19:01:00.000Z',
      actor: 'system',
      action: 'recovery_completed',
      summary: 'payments recovered',
      nodeId: 'node-a',
      serviceId: 'payments',
    }],
  }
}

test('parsesStrictDurableStateResponse', () => {
  const parsed = parser.parseStateResponse('request-1', JSON.stringify({
    id: 'request-1',
    ok: true,
    revision: 7,
    snapshot: snapshot(),
  }))

  assert.equal(parsed.revision, 7)
  assert.equal(parsed.snapshot.incidents[0]?.id, 'incident-1')
  assert.equal(parsed.snapshot.plans[0]?.status, 'executed')
  assert.equal(parsed.snapshot.semanticWatches[0]?.intervalMs, 60_000)
  assert.equal(parsed.snapshot.audit[0]?.actor, 'system')
})

test('rejectsUnexpectedFieldsAndCorrelationMismatch', () => {
  assert.throws(
    () => parser.parseStateResponse('request-1', JSON.stringify({
      id: 'request-1',
      ok: true,
      revision: 0,
      snapshot: { ...snapshot(), surprise: true },
    })),
    /unexpected or missing fields/,
  )

  assert.throws(
    () => parser.parsePingResponse('request-1', JSON.stringify({ id: 'request-2', ok: true, available: true })),
    /correlation mismatch/,
  )
})

test('rejectsDuplicateDurableIdentitiesAndSemanticTargets', () => {
  const baseSnapshot = snapshot()
  assert.throws(
    () => parser.parseSnapshot({
      ...baseSnapshot,
      audit: [
        ...(baseSnapshot['audit'] as readonly unknown[]),
        ...(baseSnapshot['audit'] as readonly unknown[]),
      ],
    }),
    /Duplicate Recovery audit ID/,
  )

  const semanticWatches = baseSnapshot['semanticWatches'] as readonly Readonly<Record<string, unknown>>[]
  const semanticWatch = semanticWatches[0] as Readonly<Record<string, unknown>>
  assert.throws(
    () => parser.parseSnapshot({
      ...baseSnapshot,
      semanticWatches: [
        semanticWatch,
        { ...semanticWatch, watchId: 'watch-2' },
      ],
    }),
    /Duplicate Recovery semantic watch target/,
  )
})

test('mapsAuthorityAndStaleRevisionFailuresToTypedErrors', () => {
  assert.throws(
    () => parser.parsePingResponse('request-1', JSON.stringify({
      id: 'request-1',
      ok: false,
      error: { code: 'authority_failure', message: 'database unavailable' },
    })),
    (error: unknown) => error instanceof RecoveryStateAuthorityError
      && error.code === 'authority_failure'
      && error.message === 'database unavailable',
  )

  assert.throws(
    () => parser.parseStateResponse('request-1', JSON.stringify({
      id: 'request-1',
      ok: false,
      error: { code: 'stale_revision', message: 'stale' },
      expectedRevision: 2,
      actualRevision: 3,
    })),
    (error: unknown) => error instanceof RecoveryStateStaleRevisionError
      && error.expectedRevision === 2
      && error.actualRevision === 3,
  )
})

test('rejectsMalformedDomainStateBeforeHydration', () => {
  assert.throws(
    () => parser.parseSnapshot({
      ...snapshot(),
      incidents: [{
        id: 'incident-1',
        nodeId: 'node-a',
        serviceId: 'payments',
        openedAt: 'not-a-date',
        status: 'invented_status',
        timeline: [],
      }],
    }),
    /status is invalid|valid timestamp|timeline must be non-empty/,
  )

  assert.throws(
    () => parser.parseStateResponse('request-1', JSON.stringify({
      id: 'request-1',
      ok: true,
      revision: Number.MAX_SAFE_INTEGER + 1,
      snapshot: snapshot(),
    })),
    /non-negative safe integer/,
  )
})
