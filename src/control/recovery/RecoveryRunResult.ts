import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { RecoveryPlan } from '../plan/RecoveryPlan.js'
import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'

export type RecoveryRunStatus = 'healthy' | 'recovered' | 'approval_required' | 'escalated'

export interface RecoveryRunResult {
  readonly status: RecoveryRunStatus
  readonly snapshot: ServiceSnapshot
  readonly incident?: IncidentRecord
  readonly investigationSummary?: string
  readonly recoveryPlan?: RecoveryPlan
  readonly restartAttempts: number
}
