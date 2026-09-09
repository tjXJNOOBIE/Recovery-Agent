import assert from 'node:assert/strict'
import test from 'node:test'

import type { RecoveryDurableSnapshot } from '../../../src/control/durability/RecoveryDurableState.js'
import { RecoveryDurableRetentionService } from '../../../src/control/durability/RecoveryDurableRetentionService.js'

test('usesLatestPlanOrIncidentTerminalTimestampForServiceRetentionUnit', () => {
  const snapshot: RecoveryDurableSnapshot = {
    schemaVersion: 2,
    incidents: [{
      id: 'incident', nodeId: 'east', serviceId: 'payments', openedAt: '2026-01-01T00:00:00.000Z', status: 'resolved',
      timeline: [{ at: '2026-01-01T00:00:00.000Z', kind: 'resolved', message: 'incident resolved' }],
    }],
    plans: [{
      id: 'plan', incidentId: 'incident', nodeId: 'east', serviceId: 'payments', action: { type: 'restart_service' }, rationale: 'finalized later', risk: 'elevated', status: 'rejected', createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z', outcome: 'rejected',
    }],
    semanticWatches: [],
    restartAttempts: [],
    nodeHealthIncidents: [],
    certificateIncidents: [],
    deploymentStates: [],
    deploymentIncidents: [],
    audit: [],
  }

  const result = new RecoveryDurableRetentionService({ terminalHistoryDays: 30, terminalHistoryPerTarget: 10 }).apply(
    snapshot,
    Date.parse('2026-09-09T00:00:00.000Z'),
  )

  assert.equal(result.snapshot.incidents[0]?.id, 'incident')
  assert.equal(result.snapshot.plans[0]?.id, 'plan')
})
