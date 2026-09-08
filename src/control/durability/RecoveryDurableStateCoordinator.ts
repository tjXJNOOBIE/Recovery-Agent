import { randomUUID } from 'node:crypto'

import type { RecoveryControlDurableState } from '../runtime/RecoveryControlRuntime.js'
import type { RecoverySemanticWatchDefinition } from '../watch/semantic/RecoverySemanticWatch.js'
import type {
  IRecoveryStateAuthority,
  RecoveryDurableAuditEntry,
  RecoveryDurableSnapshot,
  RecoveryDurableStateResult,
} from './RecoveryDurableState.js'

export interface RecoveryDurableControlSurface {
  restoreDurableState(state: RecoveryControlDurableState): void
  exportDurableState(): RecoveryControlDurableState
}

export interface RecoveryDurableSemanticWatchSurface {
  restore(definitions: readonly RecoverySemanticWatchDefinition[]): void
  list(): readonly RecoverySemanticWatchDefinition[]
}

export interface RecoveryDurableAuditRequest {
  readonly actor: string
  readonly action: string
  readonly summary: string
  readonly nodeId?: string
  readonly serviceId?: string
}

export type RecoveryDurableClock = () => number

export class RecoveryDurableStateCoordinator {
  private readonly authority: IRecoveryStateAuthority
  private readonly control: RecoveryDurableControlSurface
  private readonly semanticWatches: RecoveryDurableSemanticWatchSurface
  private readonly clock: RecoveryDurableClock
  private revision = 0
  private audit: readonly RecoveryDurableAuditEntry[] = []
  private hydrated = false

  public constructor(
    authority: IRecoveryStateAuthority,
    control: RecoveryDurableControlSurface,
    semanticWatches: RecoveryDurableSemanticWatchSurface,
    clock: RecoveryDurableClock = Date.now,
  ) {
    this.authority = authority
    this.control = control
    this.semanticWatches = semanticWatches
    this.clock = clock
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
    this.revision = loaded.revision
    this.audit = loaded.snapshot.audit.map((entry) => ({ ...entry }))
    this.hydrated = true
    return { revision: this.revision, snapshot: this.currentSnapshot() }
  }

  public currentRevision(): number {
    this.requireHydrated()
    return this.revision
  }

  public currentSnapshot(): RecoveryDurableSnapshot {
    this.requireHydrated()
    const controlState = this.control.exportDurableState()
    return {
      schemaVersion: 1,
      incidents: controlState.incidents,
      plans: controlState.plans,
      semanticWatches: this.semanticWatches.list(),
      restartAttempts: controlState.restartAttempts,
      audit: this.audit,
    }
  }

  public async checkpoint(auditRequest?: RecoveryDurableAuditRequest): Promise<RecoveryDurableStateResult> {
    this.requireHydrated()
    const candidateAudit = auditRequest === undefined
      ? this.audit
      : [...this.audit, this.createAuditEntry(auditRequest)]
    const controlState = this.control.exportDurableState()
    const candidate: RecoveryDurableSnapshot = {
      schemaVersion: 1,
      incidents: controlState.incidents,
      plans: controlState.plans,
      semanticWatches: this.semanticWatches.list(),
      restartAttempts: controlState.restartAttempts,
      audit: candidateAudit,
    }
    const committed = await this.authority.commit(this.revision, candidate)
    this.revision = committed.revision
    this.audit = committed.snapshot.audit.map((entry) => ({ ...entry }))
    return { revision: this.revision, snapshot: this.currentSnapshot() }
  }

  public close(): Promise<void> {
    return this.authority.close()
  }

  private createAuditEntry(request: RecoveryDurableAuditRequest): RecoveryDurableAuditEntry {
    const actor = this.nonBlank(request.actor, 'Recovery durable audit actor')
    const action = this.nonBlank(request.action, 'Recovery durable audit action')
    const summary = this.nonBlank(request.summary, 'Recovery durable audit summary')
    const nowMs = this.clock()
    if (!Number.isFinite(nowMs)) throw new Error('Recovery durable clock must return a finite timestamp')
    const nodeId = this.optionalText(request.nodeId)
    const serviceId = this.optionalText(request.serviceId)
    return {
      id: randomUUID(),
      at: new Date(nowMs).toISOString(),
      actor,
      action,
      summary,
      ...(nodeId === undefined ? {} : { nodeId }),
      ...(serviceId === undefined ? {} : { serviceId }),
    }
  }

  private requireHydrated(): void {
    if (!this.hydrated) throw new Error('Recovery durable state coordinator is not hydrated')
  }

  private nonBlank(value: string, label: string): string {
    const normalized = value.trim()
    if (normalized.length === 0) throw new Error(`${label} must be non-blank`)
    return normalized
  }

  private optionalText(value: string | undefined): string | undefined {
    if (value === undefined) return undefined
    const normalized = value.trim()
    return normalized.length === 0 ? undefined : normalized
  }
}
