import type { RecoveryInvestigationRequest } from '../investigation/IRecoveryInvestigator.js'
import type { RecoveryPlanProposal } from './RecoveryPlan.js'

export interface RecoveryPlanningRequest extends RecoveryInvestigationRequest {
  readonly investigationSummary: string
}

export interface IRecoveryPlanner {
  plan(request: RecoveryPlanningRequest): Promise<RecoveryPlanProposal>
}
