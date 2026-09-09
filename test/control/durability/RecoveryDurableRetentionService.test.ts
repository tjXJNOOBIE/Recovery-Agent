import assert from 'node:assert/strict'
import test from 'node:test'

import type { RecoveryDurableSnapshot } from '../../../src/control/durability/RecoveryDurableState.js'
import { RecoveryDurableRetentionService } from '../../../src/control/durability/RecoveryDurableRetentionService.js'

const nowMs = Date.parse('2026-09-09T12:00:00.000Z')

function snapshot(): RecoveryDurableSnapshot {
  return {
    schemaVersion: 2,
    incidents: [
      {
        id: 'service-old', nodeId: 'east', serviceId: 'payments', openedAt: '2026-06-01T00:00:00.000Z', status: 'resolved',
        timeline: [
          { at: '2026-06-01T00:00:00.000Z', kind: 'detected', message: 'unhealthy' },
          { at: '2026-06-01T00:10:00.000Z', kind: 'resolved', message: 'healthy' },
        ],
      },
      {
        id: 'service-new', nodeId: 'east', serviceId: 'payments', openedAt: '2026-09-08T00:00:00.000Z', status: 'resolved',
        timeline: [
          { at: '2026-09-08T00:00:00.000Z', kind: 'detected', message: 'unhealthy' },
          { at: '2026-09-08T00:10:00.000Z', kind: 'resolved', message: 'healthy' },
        ],
      },
      {
        id: 'service-active', nodeId: 'east', serviceId: 'worker', openedAt: '2026-01-01T00:00:00.000Z', status: 'human_required',
        timeline: [{ at: '2026-01-01T00:00:00.000Z', kind: 'escalated', message: 'operator required' }],
      },
    ],
    plans: [
      {
        id: 'plan-old', incidentId: 'service-old', nodeId: 'east', serviceId: 'payments', action: { type: 'restart_service' }, rationale: 'old', risk: 'elevated', status: 'executed', createdAt: '2026-06-01T00:05:00.000Z', updatedAt: '2026-06-01T00:10:00.000Z', outcome: 'healthy',
      },
      {
        id: 'plan-new', incidentId: 'service-new', nodeId: 'east', serviceId: 'payments', action: { type: 'restart_service' }, rationale: 'new', risk: 'elevated', status: 'rejected', createdAt: '2026-09-08T00:05:00.000Z', updatedAt: '2026-09-08T00:10:00.000Z', outcome: 'operator rejected',
      },
    ],
    semanticWatches: [{
      watchId: 'watch-1', request: 'watch payments', nodeId: 'east', serviceId: 'payments', intervalMs: 60_000, rationale: 'operator', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    restartAttempts: [{ nodeId: 'east', serviceId: 'payments', atMs: nowMs - 1_000 }],
    nodeHealthIncidents: [
      { id: 'node-old', nodeId: 'east', status: 'resolved', openedAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:10:00.000Z', violations: [], timeline: [{ at: '2026-06-01T00:10:00.000Z', message: 'resolved' }] },
      { id: 'node-new', nodeId: 'east', status: 'resolved', openedAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:10:00.000Z', violations: [], timeline: [{ at: '2026-09-08T00:10:00.000Z', message: 'resolved' }] },
      { id: 'node-open', nodeId: 'west', status: 'open', openedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', violations: [], timeline: [{ at: '2026-01-01T00:00:00.000Z', message: 'still open' }] },
    ],
    certificateIncidents: [
      { id: 'cert-old', nodeId: 'east', certificateId: 'api', status: 'resolved', openedAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:10:00.000Z', message: 'resolved' },
      { id: 'cert-new', nodeId: 'east', certificateId: 'api', status: 'resolved', openedAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:10:00.000Z', message: 'resolved' },
    ],
    deploymentStates: [
      { nodeId: 'east', serviceId: 'worker', status: 'stable', marker: 'marker-current', lastCheckedAt: '2026-09-08T00:00:00.000Z', incidentId: 'deployment-old' },
    ],
    deploymentIncidents: [
      { id: 'deployment-old', nodeId: 'east', serviceId: 'worker', status: 'resolved', openedAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:10:00.000Z', message: 'resolved' },
    ],
    audit: [{ id: 'audit-1', at: '2026-01-01T00:00:00.000Z', actor: 'recovery-agent', action: 'existing', summary: 'must stay forever' }],
  }
}

test('prunesOnlyTerminalDurableHistoryAndKeepsAuditAndCurrentCausality', () => {
  const source = snapshot()
  const service = new RecoveryDurableRetentionService({ terminalHistoryDays: 30, terminalHistoryPerTarget: 1 })
  const result = service.apply(source, nowMs)

  assert.deepEqual(result.snapshot.incidents.map((incident) => incident.id).sort(), ['service-active', 'service-new'])
  assert.deepEqual(result.snapshot.plans.map((plan) => plan.id), ['plan-new'])
  assert.deepEqual(result.snapshot.nodeHealthIncidents.map((incident) => incident.id).sort(), ['node-new', 'node-open'])
  assert.deepEqual(result.snapshot.certificateIncidents.map((incident) => incident.id), ['cert-new'])
  assert.deepEqual(result.snapshot.deploymentIncidents, [])
  assert.equal(result.snapshot.deploymentStates[0]?.marker, 'marker-current')
  assert.equal(result.snapshot.deploymentStates[0]?.incidentId, undefined)
  assert.deepEqual(result.snapshot.audit, source.audit)
  assert.deepEqual(result.snapshot.semanticWatches, source.semanticWatches)
  assert.deepEqual(result.snapshot.restartAttempts, source.restartAttempts)
  assert.deepEqual(result.removal.control.incidentIds, ['service-old'])
  assert.deepEqual(result.removal.control.planIds, ['plan-old'])
  assert.deepEqual(result.removal.watches.nodeHealthIncidentIds, ['node-old'])
  assert.deepEqual(result.removal.watches.certificateIncidentIds, ['cert-old'])
  assert.deepEqual(result.removal.watches.deploymentIncidentIds, ['deployment-old'])
})

test('neverPrunesResolvedIncidentWhileRelatedPlanIsStillNonTerminal', () => {
  const source = snapshot()
  const guarded: RecoveryDurableSnapshot = {
    ...source,
    incidents: [{
      id: 'guarded', nodeId: 'east', serviceId: 'payments', openedAt: '2026-01-01T00:00:00.000Z', status: 'resolved',
      timeline: [{ at: '2026-01-01T00:00:00.000Z', kind: 'resolved', message: 'resolved' }],
    }],
    plans: [{
      id: 'pending', incidentId: 'guarded', nodeId: 'east', serviceId: 'payments', action: { type: 'restart_service' }, rationale: 'pending', risk: 'elevated', status: 'pending_approval', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    nodeHealthIncidents: [],
    certificateIncidents: [],
    deploymentStates: [],
    deploymentIncidents: [],
  }

  const result = new RecoveryDurableRetentionService({ terminalHistoryDays: 1, terminalHistoryPerTarget: 1 }).apply(guarded, nowMs)
  assert.equal(result.snapshot.incidents[0]?.id, 'guarded')
  assert.equal(result.snapshot.plans[0]?.id, 'pending')
  assert.equal(RecoveryDurableRetentionService.removalCount(result.removal), 0)
})

test('rejectsInvalidRetentionPolicyAndClock', () => {
  assert.throws(() => new RecoveryDurableRetentionService({ terminalHistoryDays: 0, terminalHistoryPerTarget: 1 }), /terminalHistoryDays/)
  assert.throws(() => new RecoveryDurableRetentionService({ terminalHistoryDays: 1, terminalHistoryPerTarget: 0 }), /terminalHistoryPerTarget/)
  const service = new RecoveryDurableRetentionService({ terminalHistoryDays: 1, terminalHistoryPerTarget: 1 })
  assert.throws(() => service.apply(snapshot(), Number.NaN), /clock must be finite/)
})
