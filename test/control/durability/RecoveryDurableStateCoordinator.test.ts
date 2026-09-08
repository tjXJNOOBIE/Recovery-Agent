import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAutomaticRestartBudget } from '../../../src/control/budget/RecoveryAutomaticRestartBudget.js'
import type {
  IRecoveryStateAuthority,
  RecoveryDurableSnapshot,
  RecoveryDurableStateResult,
} from '../../../src/control/durability/RecoveryDurableState.js'
import {
  RecoveryDurableStateCoordinator,
  type RecoveryDurableControlSurface,
  type RecoveryDurableSemanticWatchSurface,
} from '../../../src/control/durability/RecoveryDurableStateCoordinator.js'
import { RecoveryStateStaleRevisionError } from '../../../src/control/durability/RecoveryDurableStateParser.js'
import type { IncidentRecord } from '../../../src/control/incident/data/IncidentRecord.js'
import { RecoveryIncidentRuntimeState } from '../../../src/control/incident/runtime/RecoveryIncidentRuntimeState.js'
import type { RecoveryPlan } from '../../../src/control/plan/RecoveryPlan.js'
import { RecoveryPlanRuntimeState } from '../../../src/control/plan/runtime/RecoveryPlanRuntimeState.js'
import type { RecoveryControlDurableState } from '../../../src/control/runtime/RecoveryControlRuntime.js'
import { RecoveryWatchService } from '../../../src/control/watch/RecoveryWatchService.js'
import type { RecoverySemanticWatchDefinition } from '../../../src/control/watch/semantic/RecoverySemanticWatch.js'
import { RecoverySemanticWatchService } from '../../../src/control/watch/semantic/RecoverySemanticWatchService.js'

const incident: IncidentRecord = {
  id: 'incident-1',
  nodeId: 'node-a',
  serviceId: 'service-a',
  openedAt: '2026-09-08T20:00:00.000Z',
  status: 'approval_required',
  timeline: [{ at: '2026-09-08T20:00:00.000Z', kind: 'detected', message: 'unhealthy' }],
}

const plan: RecoveryPlan = {
  id: 'plan-1',
  incidentId: incident.id,
  nodeId: incident.nodeId,
  serviceId: incident.serviceId,
  action: { type: 'restart_service' },
  rationale: 'one bounded restart',
  risk: 'elevated',
  status: 'pending_approval',
  createdAt: '2026-09-08T20:01:00.000Z',
  updatedAt: '2026-09-08T20:01:00.000Z',
}

const semanticWatch: RecoverySemanticWatchDefinition = {
  watchId: 'watch-1',
  request: 'watch service a every minute',
  nodeId: 'node-a',
  serviceId: 'service-a',
  intervalMs: 60_000,
  rationale: 'operator requested watch',
  createdAt: '2026-09-08T20:02:00.000Z',
  updatedAt: '2026-09-08T20:02:00.000Z',
}

const snapshot: RecoveryDurableSnapshot = {
  schemaVersion: 1,
  incidents: [incident],
  plans: [plan],
  semanticWatches: [semanticWatch],
  restartAttempts: [{ nodeId: 'node-a', serviceId: 'service-a', atMs: 1_000 }],
  audit: [{
    id: 'audit-1',
    at: '2026-09-08T20:03:00.000Z',
    actor: 'recovery-agent',
    action: 'hydrate_fixture',
    summary: 'fixture state exists',
  }],
}

class FakeControl implements RecoveryDurableControlSurface {
  public state: RecoveryControlDurableState = { incidents: [], plans: [], restartAttempts: [] }

  public restoreDurableState(state: RecoveryControlDurableState): void {
    this.state = {
      incidents: [...state.incidents],
      plans: [...state.plans],
      restartAttempts: [...state.restartAttempts],
    }
  }

  public exportDurableState(): RecoveryControlDurableState {
    return this.state
  }
}

class FakeSemanticWatches implements RecoveryDurableSemanticWatchSurface {
  public definitions: readonly RecoverySemanticWatchDefinition[] = []

  public restore(definitions: readonly RecoverySemanticWatchDefinition[]): void {
    this.definitions = [...definitions]
  }

  public list(): readonly RecoverySemanticWatchDefinition[] {
    return this.definitions
  }
}

class FakeAuthority implements IRecoveryStateAuthority {
  public revision: number
  public snapshot: RecoveryDurableSnapshot
  public commitCalls = 0
  public closeCalls = 0
  public staleActualRevision: number | undefined

  public constructor(initialRevision: number, initialSnapshot: RecoveryDurableSnapshot) {
    this.revision = initialRevision
    this.snapshot = initialSnapshot
  }

  public async ping(): Promise<boolean> { return true }

  public async load(): Promise<RecoveryDurableStateResult> {
    return { revision: this.revision, snapshot: this.snapshot }
  }

  public async commit(expectedRevision: number, next: RecoveryDurableSnapshot): Promise<RecoveryDurableStateResult> {
    this.commitCalls += 1
    if (this.staleActualRevision !== undefined) {
      throw new RecoveryStateStaleRevisionError('stale', expectedRevision, this.staleActualRevision)
    }
    assert.equal(expectedRevision, this.revision)
    this.revision += 1
    this.snapshot = next
    return { revision: this.revision, snapshot: next }
  }

  public async close(): Promise<void> { this.closeCalls += 1 }
}

test('hydratesRuntimeStateAndCheckpointsMonotonicAudit', async () => {
  const authority = new FakeAuthority(7, snapshot)
  const control = new FakeControl()
  const semanticWatches = new FakeSemanticWatches()
  const coordinator = new RecoveryDurableStateCoordinator(
    authority,
    control,
    semanticWatches,
    () => Date.parse('2026-09-08T21:00:00.000Z'),
  )

  const loaded = await coordinator.hydrate()
  assert.equal(loaded.revision, 7)
  assert.deepEqual(control.state.incidents, [incident])
  assert.deepEqual(control.state.plans, [plan])
  assert.deepEqual(control.state.restartAttempts, snapshot.restartAttempts)
  assert.deepEqual(semanticWatches.definitions, [semanticWatch])

  const committed = await coordinator.checkpoint({
    actor: 'recovery-agent',
    action: 'startup_hydrated',
    summary: 'Hydrated durable recovery state before watches started',
  })
  assert.equal(committed.revision, 8)
  assert.equal(committed.snapshot.audit.length, 2)
  assert.equal(committed.snapshot.audit[1]?.action, 'startup_hydrated')
  assert.equal(authority.commitCalls, 1)

  await coordinator.close()
  assert.equal(authority.closeCalls, 1)
})

test('staleRevisionDoesNotAdvanceCoordinatorRevisionOrAudit', async () => {
  const authority = new FakeAuthority(3, snapshot)
  const coordinator = new RecoveryDurableStateCoordinator(
    authority,
    new FakeControl(),
    new FakeSemanticWatches(),
  )
  await coordinator.hydrate()
  authority.staleActualRevision = 4

  await assert.rejects(
    coordinator.checkpoint({ actor: 'test', action: 'stale', summary: 'must fail closed' }),
    RecoveryStateStaleRevisionError,
  )
  assert.equal(coordinator.currentRevision(), 3)
  assert.equal(coordinator.currentSnapshot().audit.length, 1)
})

test('runtimeStateOwnersRejectUnsafeRestoreShapes', () => {
  const incidents = new RecoveryIncidentRuntimeState()
  assert.throws(() => incidents.restore([incident, incident]), /Duplicate recovery incident id/)

  const plans = new RecoveryPlanRuntimeState()
  assert.throws(() => plans.restore([
    plan,
    { ...plan, id: 'plan-2' },
  ]), /Multiple pending recovery plans/)

  const budget = new RecoveryAutomaticRestartBudget(() => 1_500)
  budget.restoreAttempts([{ nodeId: 'node-a', serviceId: 'service-a', atMs: 1_000 }])
  assert.equal(budget.inspect({
    nodeId: 'node-a',
    serviceId: 'service-a',
    expectedState: 'running',
    restartAllowed: true,
    maxRestartAttempts: 2,
    restartBudgetWindowMs: 1_000,
  }).usedAttempts, 1)
})

test('semanticWatchRestoreRejectsTargetsOutsideConfiguredFleet', () => {
  const serviceWatches = new RecoveryWatchService(
    { recoverService: async () => { throw new Error('not used') } },
    [],
  )
  const semantic = new RecoverySemanticWatchService(
    { compile: async () => { throw new Error('not used') } },
    serviceWatches,
    [{ nodeId: 'node-a', serviceId: 'service-a' }],
  )

  semantic.restore([semanticWatch])
  assert.equal(semantic.list()[0]?.watchId, 'watch-1')
  assert.throws(
    () => semantic.restore([{ ...semanticWatch, watchId: 'watch-2', serviceId: 'unknown' }]),
    /not configured/,
  )
  assert.equal(semantic.list()[0]?.watchId, 'watch-1')
})
