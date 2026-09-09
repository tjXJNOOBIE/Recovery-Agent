import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { RecoveryPlan } from '../plan/RecoveryPlan.js'

export type RecoveryPostmortemConfidence = 'low' | 'medium' | 'high'

export interface RecoveryPostmortem {
  readonly incidentId: string
  readonly summary: string
  readonly rootCause: string
  readonly contributingFactors: readonly string[]
  readonly recovery: string
  readonly prevention: readonly string[]
  readonly confidence: RecoveryPostmortemConfidence
}

export interface RecoveryPostmortemRequest {
  readonly incident: IncidentRecord
  readonly plans: readonly RecoveryPlan[]
}

export interface IRecoveryPostmortemGenerator {
  generate(request: RecoveryPostmortemRequest): Promise<RecoveryPostmortem>
}
