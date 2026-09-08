import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'

export type RecoveryRunStatus = 'healthy' | 'recovered' | 'escalated'

export interface RecoveryRunResult {
  readonly status: RecoveryRunStatus
  readonly snapshot: ServiceSnapshot
  readonly incident?: IncidentRecord
  readonly investigationSummary?: string
  readonly restartAttempts: number
}
