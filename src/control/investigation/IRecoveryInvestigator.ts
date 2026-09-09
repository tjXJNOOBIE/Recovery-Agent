import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { IncidentRecord } from '../incident/data/IncidentRecord.js'

export interface RecoveryInvestigationRequest {
  readonly incident: IncidentRecord
  readonly before: ServiceSnapshot
  readonly afterAttempts: ServiceSnapshot
  readonly attempts: number
}

export interface RecoveryInvestigationResult {
  readonly summary: string
  readonly requiresHuman: boolean
}

export interface IRecoveryInvestigator {
  investigate(request: RecoveryInvestigationRequest): Promise<RecoveryInvestigationResult>
}
