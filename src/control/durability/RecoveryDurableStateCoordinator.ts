import { randomUUID } from 'node:crypto'

import type { RecoveryControlDurableState } from '../runtime/RecoveryControlRuntime.js'
import type { RecoverySemanticWatchDefinition } from '../watch/semantic/RecoverySemanticWatch.js'
import type {
  IRecoveryStateAuthority,
  RecoveryDurableAuditEntry,
  RecoveryDurableSnapshot,
  RecoveryDurableStateResult,
  RecoveryDurableWatchState,
} from './RecoveryDurableState.js'
import {
  RecoveryDurableRetentionService,
  type RecoveryDurableRetentionRemoval,
} from './RecoveryDurableRetentionService.js'

export interface RecoveryDurableControlSurface {
  restoreDurableState(state: RecoveryControlDurableState): void
  exportDurableState(): RecoveryControlDurableState
}

export interface RecoveryDurableSemanticWatchSurface {
  restore(definitions: readonly RecoverySemanticWatchDefinition[]): void
  list(): readonly RecoverySemanticWatchDefinition[]
}

export interface RecoveryDurableWatchStateSurface {
  restoreDurableState(state: RecoveryDurableWatchState): void
  exportDurableState(): RecoveryDurableWatchState
}

export interface RecoveryDurableAuditRequest {
  readonly actor: string
  readonly action: string
  readonly summary: string
  readonly nodeId?: string
  readonly serviceId?: string
}

export interface RecoveryDurableCheckpointOverrides {
  readonly semanticWatches?: readonly RecoverySemanticWatchDefinition[]
}

export type RecoveryDurableClock = () => number

const EMPTY_WATCH_STATE: RecoveryDurableWatchState = {
  nodeHealthIncidents: [],
  certificateIncidents: [],
  deploymentStates: [],
  deploymentIncidents: [],
}

export class RecoveryDurableStateCoordinator {
  private readonly authority: IRecoveryStateAuthority
  private readonly control: RecoveryDurableControlSurface
  private readonly semanticWatches: RecoveryDurableSemanticWatchSurface
  private readonly clock: RecoveryDurableClock
  private readonly watchState: RecoveryDurableWatchStateSurface | undefined
  private readonly retention: RecoveryDurableRetentionService | undefined
  private readonly committedPrunedHistoryKeys = new Set<string>()
  private revision = 0
  private audit: readonly RecoveryDurableAuditEntry[] = []
  private hydrated = false
  private checkpointTail: Promise<void> = Promise.resolve()

  public constructor(
    authority: IRecoveryStateAuthority,
    control: RecoveryDurableControlSurface,
    semanticWatches: RecoveryDurableSemanticWatchSurface,
    clock: RecoveryDurableClock = Date.now,
    watchState?: RecoveryDurableWatchStateSurface,
    retention?: RecoveryDurableRetentionService,
  ) {
    this.authority = authority
    this.control = control
    this.semanticWatches = semanticWatches
    this.clock = clock
    this.watchState = watchState
    this.retention = retention
  }

  public async hydrate(): Promise<RecoveryDurableStateResult> {
    if (this.hydrated) throw new Error('Recovery durable state coordinator is already hydrated')
    const loaded = await this.authority.load()
    this.control.restoreDurableState({
      incidents: loaded.snapshot.incidents,
      plans: loaded.snapshot.plans,
      restartAttempts: loaded.snapshot.restartAttempts,
    })
    this.semanticWatches.restore(loaded.snapshot.semanticWatches)
    this.watchState?.restoreDurableState({
      nodeHealthIncidents: loaded.snapshot.nodeHealthIncidents,
      certificateIncidents: loaded.snapshot.certificateIncidents,
      deploymentStates: loaded.snapshot.deploymentStates,
      deploymentIncidents: loaded.snapshot.deploymentIncidents,
    })
    this.revision = loaded.revision
    this.audit = loaded.snapshot.audit.map((entry) => ({ ...entry }))
    this.hydrated = true
    return loaded
  }

  public currentRevision(): number { this.requireHydrated(); return this.revision }

  public currentSnapshot(): RecoveryDurableSnapshot {
    this.requireHydrated()
    return this.buildCandidateSnapshot(this.audit)
  }

  public checkpoint(auditRequest?: RecoveryDurableAuditRequest, overrides?: RecoveryDurableCheckpointOverrides): Promise<RecoveryDurableStateResult> {
    this.requireHydrated()
    const run = this.checkpointTail.then(() => this.performCheckpoint(auditRequest, overrides), () => this.performCheckpoint(auditRequest, overrides))
    this.checkpointTail = run.then(() => undefined, () => undefined)
    return run
  }

  public async close(): Promise<void> { await this.checkpointTail; await this.authority.close() }

  private async performCheckpoint(auditRequest?: RecoveryDurableAuditRequest, overrides?: RecoveryDurableCheckpointOverrides): Promise<RecoveryDurableStateResult> {
    const candidateAudit = auditRequest === undefined ? this.audit : [...this.audit, this.createAuditEntry(auditRequest)]
    let candidate = this.buildCandidateSnapshot(candidateAudit, overrides)
    let newlyPruned: RecoveryDurableRetentionRemoval | undefined

    if (this.retention !== undefined) {
      const retentionResult = this.retention.apply(candidate, this.now())
      newlyPruned = this.filterNewRetention(retentionResult.removal)
      candidate = retentionResult.snapshot
      if (RecoveryDurableRetentionService.removalCount(newlyPruned) > 0) {
        candidate = {
          ...candidate,
          audit: [...candidate.audit, this.createAuditEntry({
            actor: 'recovery-agent',
            action: 'retention_cleanup',
            summary: this.retentionSummary(newlyPruned),
          })],
        }
      }
    }

    const committed = await this.authority.commit(this.revision, candidate)
    this.revision = committed.revision
    this.audit = committed.snapshot.audit.map((entry) => ({ ...entry }))
    if (newlyPruned !== undefined) this.rememberCommittedRetention(newlyPruned)
    return committed
  }

  private buildCandidateSnapshot(
    audit: readonly RecoveryDurableAuditEntry[],
    overrides?: RecoveryDurableCheckpointOverrides,
  ): RecoveryDurableSnapshot {
    const controlState = this.control.exportDurableState()
    const watchState = this.watchState?.exportDurableState() ?? EMPTY_WATCH_STATE
    return {
      schemaVersion: 2,
      incidents: controlState.incidents,
      plans: controlState.plans,
      semanticWatches: overrides?.semanticWatches ?? this.semanticWatches.list(),
      restartAttempts: controlState.restartAttempts,
      nodeHealthIncidents: watchState.nodeHealthIncidents,
      certificateIncidents: watchState.certificateIncidents,
      deploymentStates: watchState.deploymentStates,
      deploymentIncidents: watchState.deploymentIncidents,
      audit,
    }
  }

  private filterNewRetention(removal: RecoveryDurableRetentionRemoval): RecoveryDurableRetentionRemoval {
    return {
      control: {
        incidentIds: removal.control.incidentIds.filter((id) => !this.committedPrunedHistoryKeys.has(`incident:${id}`)),
        planIds: removal.control.planIds.filter((id) => !this.committedPrunedHistoryKeys.has(`plan:${id}`)),
      },
      watches: {
        nodeHealthIncidentIds: removal.watches.nodeHealthIncidentIds.filter((id) => !this.committedPrunedHistoryKeys.has(`node:${id}`)),
        certificateIncidentIds: removal.watches.certificateIncidentIds.filter((id) => !this.committedPrunedHistoryKeys.has(`certificate:${id}`)),
        deploymentIncidentIds: removal.watches.deploymentIncidentIds.filter((id) => !this.committedPrunedHistoryKeys.has(`deployment:${id}`)),
      },
    }
  }

  private rememberCommittedRetention(removal: RecoveryDurableRetentionRemoval): void {
    for (const id of removal.control.incidentIds) this.committedPrunedHistoryKeys.add(`incident:${id}`)
    for (const id of removal.control.planIds) this.committedPrunedHistoryKeys.add(`plan:${id}`)
    for (const id of removal.watches.nodeHealthIncidentIds) this.committedPrunedHistoryKeys.add(`node:${id}`)
    for (const id of removal.watches.certificateIncidentIds) this.committedPrunedHistoryKeys.add(`certificate:${id}`)
    for (const id of removal.watches.deploymentIncidentIds) this.committedPrunedHistoryKeys.add(`deployment:${id}`)
  }

  private retentionSummary(removal: RecoveryDurableRetentionRemoval): string {
    return `Pruned terminal durable history: incidents=${removal.control.incidentIds.length}, plans=${removal.control.planIds.length}, nodeHealth=${removal.watches.nodeHealthIncidentIds.length}, certificates=${removal.watches.certificateIncidentIds.length}, deployments=${removal.watches.deploymentIncidentIds.length}; audit history retained`
  }

  private createAuditEntry(request: RecoveryDurableAuditRequest): RecoveryDurableAuditEntry {
    const actor = this.nonBlank(request.actor, 'Recovery durable audit actor')
    const action = this.nonBlank(request.action, 'Recovery durable audit action')
    const summary = this.nonBlank(request.summary, 'Recovery durable audit summary')
    const nowMs = this.now()
    const nodeId = this.optionalText(request.nodeId); const serviceId = this.optionalText(request.serviceId)
    return { id: randomUUID(), at: new Date(nowMs).toISOString(), actor, action, summary, ...(nodeId === undefined ? {} : { nodeId }), ...(serviceId === undefined ? {} : { serviceId }) }
  }

  private now(): number {
    const value = this.clock()
    if (!Number.isFinite(value)) throw new Error('Recovery durable clock must return a finite timestamp')
    return value
  }

  private requireHydrated(): void { if (!this.hydrated) throw new Error('Recovery durable state coordinator is not hydrated') }
  private nonBlank(value: string, label: string): string { const normalized = value.trim(); if (normalized.length === 0) throw new Error(`${label} must be non-blank`); return normalized }
  private optionalText(value: string | undefined): string | undefined { if (value === undefined) return undefined; const normalized = value.trim(); return normalized.length === 0 ? undefined : normalized }
}
