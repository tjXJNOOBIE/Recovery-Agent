import type { IncidentEventKind, IncidentRecord, IncidentStatus } from '../incident/data/IncidentRecord.js'
import type { RecoveryPlan, RecoveryPlanStatus } from '../plan/RecoveryPlan.js'
import type { RecoverySemanticWatchDefinition } from '../watch/semantic/RecoverySemanticWatch.js'
import type {
  RecoveryDurableAuditEntry,
  RecoveryDurableRestartAttempt,
  RecoveryDurableSnapshot,
  RecoveryDurableStateResult,
} from './RecoveryDurableState.js'

const INCIDENT_STATUSES: readonly IncidentStatus[] = [
  'open',
  'recovering',
  'dependency_blocked',
  'approval_required',
  'resolved',
  'human_required',
]

const INCIDENT_EVENT_KINDS: readonly IncidentEventKind[] = [
  'detected',
  'dependency',
  'action',
  'verification',
  'investigation',
  'plan_proposed',
  'plan_review',
  'approval',
  'plan_execution',
  'resolved',
  'escalated',
]

const PLAN_STATUSES: readonly RecoveryPlanStatus[] = [
  'pending_approval',
  'approved',
  'executed',
  'rejected',
  'failed',
  'superseded',
]

export class RecoveryStateAuthorityError extends Error {
  public readonly code: string

  public constructor(code: string, message: string) {
    super(message)
    this.name = 'RecoveryStateAuthorityError'
    this.code = code
  }
}

export class RecoveryStateStaleRevisionError extends RecoveryStateAuthorityError {
  public readonly expectedRevision: number
  public readonly actualRevision: number

  public constructor(message: string, expectedRevision: number, actualRevision: number) {
    super('stale_revision', message)
    this.name = 'RecoveryStateStaleRevisionError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export class RecoveryDurableStateParser {
  public parsePingResponse(requestId: string, value: string): boolean {
    const record = this.responseRecord(requestId, value)
    if (record['ok'] === false) this.throwAuthorityError(record)
    this.exactKeys(record, ['available', 'id', 'ok'], 'Recovery state ping response')
    return this.boolean(record, 'available')
  }

  public parseStateResponse(requestId: string, value: string): RecoveryDurableStateResult {
    const record = this.responseRecord(requestId, value)
    if (record['ok'] === false) this.throwAuthorityError(record)
    this.exactKeys(record, ['id', 'ok', 'revision', 'snapshot'], 'Recovery state response')
    return {
      revision: this.nonNegativeSafeInteger(record, 'revision'),
      snapshot: this.parseSnapshot(record['snapshot']),
    }
  }

  public parseSnapshot(value: unknown): RecoveryDurableSnapshot {
    const record = this.record(value, 'Recovery durable snapshot')
    this.exactKeys(
      record,
      ['audit', 'incidents', 'plans', 'restartAttempts', 'schemaVersion', 'semanticWatches'],
      'Recovery durable snapshot',
    )
    if (record['schemaVersion'] !== 1) throw new Error('Recovery durable snapshot schemaVersion must equal 1')

    const incidents = this.array(record, 'incidents').map((entry, index) => this.incident(entry, index))
    const plans = this.array(record, 'plans').map((entry, index) => this.plan(entry, index))
    const semanticWatches = this.array(record, 'semanticWatches').map((entry, index) => this.semanticWatch(entry, index))
    const restartAttempts = this.array(record, 'restartAttempts').map((entry, index) => this.restartAttempt(entry, index))
    const audit = this.array(record, 'audit').map((entry, index) => this.auditEntry(entry, index))

    this.unique(incidents.map((incident) => incident.id), 'incident ID')
    this.unique(plans.map((plan) => plan.id), 'recovery plan ID')
    this.unique(semanticWatches.map((watch) => watch.watchId), 'semantic watch ID')
    this.unique(semanticWatches.map((watch) => `${watch.nodeId}/${watch.serviceId}`), 'semantic watch target')
    this.unique(audit.map((entry) => entry.id), 'audit ID')

    return { schemaVersion: 1, incidents, plans, semanticWatches, restartAttempts, audit }
  }

  private responseRecord(requestId: string, value: string): Readonly<Record<string, unknown>> {
    let parsed: unknown
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      throw new Error('Recovery state authority response must be valid JSON')
    }
    const record = this.record(parsed, 'Recovery state authority response')
    const id = record['id']
    if (typeof id !== 'string' || id !== requestId) {
      throw new Error(`Recovery state response correlation mismatch: expected ${requestId}`)
    }
    if (record['ok'] !== true && record['ok'] !== false) throw new Error('Recovery state response ok must be boolean')
    return record
  }

  private throwAuthorityError(record: Readonly<Record<string, unknown>>): never {
    const error = this.record(record['error'], 'Recovery state authority error')
    this.exactKeys(error, ['code', 'message'], 'Recovery state authority error')
    const code = this.nonBlankString(error, 'code', 128)
    const message = this.nonBlankString(error, 'message', 4_000)
    if (code === 'stale_revision') {
      this.exactKeys(record, ['actualRevision', 'error', 'expectedRevision', 'id', 'ok'], 'Recovery stale revision response')
      throw new RecoveryStateStaleRevisionError(
        message,
        this.nonNegativeSafeInteger(record, 'expectedRevision'),
        this.nonNegativeSafeInteger(record, 'actualRevision'),
      )
    }
    this.exactKeys(record, ['error', 'id', 'ok'], 'Recovery state authority error response')
    throw new RecoveryStateAuthorityError(code, message)
  }

  private incident(value: unknown, index: number): IncidentRecord {
    const label = `Recovery incident[${index}]`
    const record = this.record(value, label)
    this.exactKeys(record, ['id', 'nodeId', 'openedAt', 'serviceId', 'status', 'timeline'], label)
    const status = record['status']
    if (!INCIDENT_STATUSES.includes(status as IncidentStatus)) throw new Error(`${label} status is invalid`)
    const timeline = this.array(record, 'timeline').map((entry, timelineIndex) => {
      const timelineLabel = `${label}.timeline[${timelineIndex}]`
      const timelineRecord = this.record(entry, timelineLabel)
      this.exactKeys(timelineRecord, ['at', 'kind', 'message'], timelineLabel)
      const kind = timelineRecord['kind']
      if (!INCIDENT_EVENT_KINDS.includes(kind as IncidentEventKind)) throw new Error(`${timelineLabel} kind is invalid`)
      return {
        at: this.timestamp(timelineRecord, 'at'),
        kind: kind as IncidentEventKind,
        message: this.nonBlankString(timelineRecord, 'message', 8_000),
      }
    })
    if (timeline.length === 0) throw new Error(`${label} timeline must be non-empty`)
    return {
      id: this.nonBlankString(record, 'id', 256),
      nodeId: this.nonBlankString(record, 'nodeId', 256),
      serviceId: this.nonBlankString(record, 'serviceId', 256),
      openedAt: this.timestamp(record, 'openedAt'),
      status: status as IncidentStatus,
      timeline,
    }
  }

  private plan(value: unknown, index: number): RecoveryPlan {
    const label = `Recovery plan[${index}]`
    const record = this.record(value, label)
    const hasOutcome = record['outcome'] !== undefined
    this.exactKeys(
      record,
      hasOutcome
        ? ['action', 'createdAt', 'id', 'incidentId', 'nodeId', 'outcome', 'rationale', 'risk', 'serviceId', 'status', 'updatedAt']
        : ['action', 'createdAt', 'id', 'incidentId', 'nodeId', 'rationale', 'risk', 'serviceId', 'status', 'updatedAt'],
      label,
    )
    const action = this.record(record['action'], `${label}.action`)
    this.exactKeys(action, ['type'], `${label}.action`)
    if (action['type'] !== 'restart_service') throw new Error(`${label} action type is invalid`)
    const status = record['status']
    if (!PLAN_STATUSES.includes(status as RecoveryPlanStatus)) throw new Error(`${label} status is invalid`)
    if (record['risk'] !== 'elevated') throw new Error(`${label} risk must be elevated`)
    return {
      id: this.nonBlankString(record, 'id', 256),
      incidentId: this.nonBlankString(record, 'incidentId', 256),
      nodeId: this.nonBlankString(record, 'nodeId', 256),
      serviceId: this.nonBlankString(record, 'serviceId', 256),
      action: { type: 'restart_service' },
      rationale: this.nonBlankString(record, 'rationale', 8_000),
      risk: 'elevated',
      status: status as RecoveryPlanStatus,
      createdAt: this.timestamp(record, 'createdAt'),
      updatedAt: this.timestamp(record, 'updatedAt'),
      ...(hasOutcome ? { outcome: this.nonBlankString(record, 'outcome', 8_000) } : {}),
    }
  }

  private semanticWatch(value: unknown, index: number): RecoverySemanticWatchDefinition {
    const label = `Recovery semantic watch[${index}]`
    const record = this.record(value, label)
    this.exactKeys(record, ['createdAt', 'intervalMs', 'nodeId', 'rationale', 'request', 'serviceId', 'updatedAt', 'watchId'], label)
    const intervalMs = this.positiveSafeInteger(record, 'intervalMs')
    return {
      watchId: this.nonBlankString(record, 'watchId', 256),
      request: this.nonBlankString(record, 'request', 16_000),
      nodeId: this.nonBlankString(record, 'nodeId', 256),
      serviceId: this.nonBlankString(record, 'serviceId', 256),
      intervalMs,
      rationale: this.nonBlankString(record, 'rationale', 8_000),
      createdAt: this.timestamp(record, 'createdAt'),
      updatedAt: this.timestamp(record, 'updatedAt'),
    }
  }

  private restartAttempt(value: unknown, index: number): RecoveryDurableRestartAttempt {
    const label = `Recovery restart attempt[${index}]`
    const record = this.record(value, label)
    this.exactKeys(record, ['atMs', 'nodeId', 'serviceId'], label)
    return {
      nodeId: this.nonBlankString(record, 'nodeId', 256),
      serviceId: this.nonBlankString(record, 'serviceId', 256),
      atMs: this.nonNegativeSafeInteger(record, 'atMs'),
    }
  }

  private auditEntry(value: unknown, index: number): RecoveryDurableAuditEntry {
    const label = `Recovery audit[${index}]`
    const record = this.record(value, label)
    const keys = ['action', 'actor', 'at', 'id', 'summary']
    if (record['nodeId'] !== undefined) keys.push('nodeId')
    if (record['serviceId'] !== undefined) keys.push('serviceId')
    this.exactKeys(record, keys, label)
    return {
      id: this.nonBlankString(record, 'id', 256),
      at: this.timestamp(record, 'at'),
      actor: this.nonBlankString(record, 'actor', 512),
      action: this.nonBlankString(record, 'action', 512),
      summary: this.nonBlankString(record, 'summary', 8_000),
      ...(record['nodeId'] === undefined ? {} : { nodeId: this.nonBlankString(record, 'nodeId', 256) }),
      ...(record['serviceId'] === undefined ? {} : { serviceId: this.nonBlankString(record, 'serviceId', 256) }),
    }
  }

  private record(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
    return value as Readonly<Record<string, unknown>>
  }

  private exactKeys(record: Readonly<Record<string, unknown>>, expected: readonly string[], label: string): void {
    const actual = Object.keys(record).sort()
    const wanted = [...expected].sort()
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} contains unexpected or missing fields`)
  }

  private array(record: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
    const value = record[key]
    if (!Array.isArray(value)) throw new Error(`${key} must be an array`)
    return value
  }

  private nonBlankString(record: Readonly<Record<string, unknown>>, key: string, maximumLength: number): string {
    const value = record[key]
    if (typeof value !== 'string') throw new Error(`${key} must be a string`)
    const normalized = value.trim()
    if (normalized.length === 0 || normalized.length > maximumLength) {
      throw new Error(`${key} must be non-blank and no longer than ${maximumLength} characters`)
    }
    return normalized
  }

  private boolean(record: Readonly<Record<string, unknown>>, key: string): boolean {
    const value = record[key]
    if (typeof value !== 'boolean') throw new Error(`${key} must be boolean`)
    return value
  }

  private nonNegativeSafeInteger(record: Readonly<Record<string, unknown>>, key: string): number {
    const value = record[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a non-negative safe integer`)
    return value
  }

  private positiveSafeInteger(record: Readonly<Record<string, unknown>>, key: string): number {
    const value = this.nonNegativeSafeInteger(record, key)
    if (value === 0) throw new Error(`${key} must be positive`)
    return value
  }

  private timestamp(record: Readonly<Record<string, unknown>>, key: string): string {
    const value = this.nonBlankString(record, key, 128)
    if (!Number.isFinite(Date.parse(value))) throw new Error(`${key} must be a valid timestamp`)
    return value
  }

  private unique(values: readonly string[], label: string): void {
    const seen = new Set<string>()
    for (const value of values) {
      if (seen.has(value)) throw new Error(`Duplicate Recovery ${label}: ${value}`)
      seen.add(value)
    }
  }
}
