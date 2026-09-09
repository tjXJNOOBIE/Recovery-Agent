import assert from 'node:assert/strict'
import test from 'node:test'

import type { RecoveryControlDurableState } from '../../../src/control/runtime/RecoveryControlRuntime.js'
import type {
  IRecoveryStateAuthority,
  RecoveryDurableSnapshot,
  RecoveryDurableStateResult,
} from '../../../src/control/durability/RecoveryDurableState.js'
import { RecoveryDurableRetentionService } from '../../../src/control/durability/RecoveryDurableRetentionService.js'
import {
  RecoveryDurableStateCoordinator,
  type RecoveryDurableControlSurface,
  type RecoveryDurableSemanticWatchSurface,
} from '../../../src/control/durability/RecoveryDurableStateCoordinator.js'
import type { RecoverySemanticWatchDefinition } from '../../../src/control/watch/semantic/RecoverySemanticWatch.js'

const clockMs = Date.parse('2026-09-09T12:00:00.000Z')

function oldSnapshot(): RecoveryDurableSnapshot {
  return {
    schemaVersion: 2,
    incidents: [{
      id: 'old-incident', nodeId: 'east', serviceId: 'payments', openedAt: '2026-01-01T00:00:00.000Z', status: 'resolved',
      timeline: [
        { at: '2026-01-01T00:00:00.000Z', kind: 'detected', message: 'unhealthy' },
        { at: '2026-01-01T00:10:00.000Z', kind: 'resolved', message: 'healthy' },
      ],
    }],
    plans: [{
      id: 'old-plan', incidentId: 'old-incident', nodeId: 'east', serviceId: 'payments', action: { type: 'restart_service' }, rationale: 'old', risk: 'elevated', status: 'executed', createdAt: '2026-01-01T00:05:00.000Z', updatedAt: '2026-01-01T00:10:00.000Z', outcome: 'healthy',
    }],
    semanticWatches: [],
    restartAttempts: [],
    nodeHealthIncidents: [],
    certificateIncidents: [],
    deploymentStates: [],
    deploymentIncidents: [],
    audit: [],
  }
}

class FakeControl implements RecoveryDurableControlSurface {
  public state: RecoveryControlDurableState = { incidents: [], plans: [], restartAttempts: [] }

  public restoreDurableState(state: RecoveryControlDurableState): void {
    this.state = { incidents: [...state.incidents], plans: [...state.plans], restartAttempts: [...state.restartAttempts] }
  }

  public exportDurableState(): RecoveryControlDurableState {
    return this.state
  }
}

class FakeSemanticWatches implements RecoveryDurableSemanticWatchSurface {
  public definitions: readonly RecoverySemanticWatchDefinition[] = []
  public restore(definitions: readonly RecoverySemanticWatchDefinition[]): void { this.definitions = [...definitions] }
  public list(): readonly RecoverySemanticWatchDefinition[] { return this.definitions }
}

class FakeAuthority implements IRecoveryStateAuthority {
  public revision = 0
  public snapshot: RecoveryDurableSnapshot
  public commitCalls = 0
  public failNextCommit = false

  public constructor(snapshot: RecoveryDurableSnapshot) {
    this.snapshot = snapshot
  }

  public async ping(): Promise<boolean> { return true }
  public async load(): Promise<RecoveryDurableStateResult> { return { revision: this.revision, snapshot: this.snapshot } }

  public async commit(expectedRevision: number, snapshot: RecoveryDurableSnapshot): Promise<RecoveryDurableStateResult> {
    this.commitCalls += 1
    assert.equal(expectedRevision, this.revision)
    if (this.failNextCommit) {
      this.failNextCommit = false
      throw new Error('simulated durable failure')
    }
    this.revision += 1
    this.snapshot = snapshot
    return { revision: this.revision, snapshot }
  }

  public async close(): Promise<void> {}
}

test('filtersTerminalHistoryBeforeAuthorityCommitWithoutMutatingLiveRuntimeAndAuditsOnce', async () => {
  const authority = new FakeAuthority(oldSnapshot())
  const control = new FakeControl()
  const coordinator = new RecoveryDurableStateCoordinator(
    authority,
    control,
    new FakeSemanticWatches(),
    () => clockMs,
    undefined,
    new RecoveryDurableRetentionService({ terminalHistoryDays: 30, terminalHistoryPerTarget: 10 }),
  )

  await coordinator.hydrate()
  const first = await coordinator.checkpoint({ actor: 'test', action: 'first', summary: 'first checkpoint' })

  assert.deepEqual(first.snapshot.incidents, [])
  assert.deepEqual(first.snapshot.plans, [])
  assert.deepEqual(first.snapshot.audit.map((entry) => entry.action), ['first', 'retention_cleanup'])
  assert.equal(first.snapshot.audit[1]?.summary.includes('audit history retained'), true)
  assert.equal(control.state.incidents[0]?.id, 'old-incident', 'live terminal history remains until restart')
  assert.equal(coordinator.currentSnapshot().incidents[0]?.id, 'old-incident')

  const second = await coordinator.checkpoint({ actor: 'test', action: 'second', summary: 'second checkpoint' })
  assert.deepEqual(second.snapshot.incidents, [])
  assert.deepEqual(second.snapshot.audit.map((entry) => entry.action), ['first', 'retention_cleanup', 'second'])
  assert.equal(second.snapshot.audit.filter((entry) => entry.action === 'retention_cleanup').length, 1)
})

test('failedRetentionCommitDoesNotMarkHistoryAsCleanedAndNextSuccessfulCommitAuditsIt', async () => {
  const authority = new FakeAuthority(oldSnapshot())
  const coordinator = new RecoveryDurableStateCoordinator(
    authority,
    new FakeControl(),
    new FakeSemanticWatches(),
    () => clockMs,
    undefined,
    new RecoveryDurableRetentionService({ terminalHistoryDays: 30, terminalHistoryPerTarget: 10 }),
  )
  await coordinator.hydrate()
  authority.failNextCommit = true

  await assert.rejects(
    coordinator.checkpoint({ actor: 'test', action: 'failed', summary: 'must not commit' }),
    /simulated durable failure/,
  )
  assert.equal(authority.revision, 0)
  assert.deepEqual(authority.snapshot.audit, [])

  const committed = await coordinator.checkpoint({ actor: 'test', action: 'retry', summary: 'retry checkpoint' })
  assert.equal(committed.revision, 1)
  assert.deepEqual(committed.snapshot.incidents, [])
  assert.deepEqual(committed.snapshot.audit.map((entry) => entry.action), ['retry', 'retention_cleanup'])
})
