import type { RecoveryPlanningRequest } from './IRecoveryPlanner.js'
import type { RecoveryPlanProposal } from './RecoveryPlan.js'

export interface RecoveryPlanReview {
  readonly accepted: boolean
  readonly concerns: readonly string[]
}

export interface IRecoveryPlanCritic {
  review(request: RecoveryPlanningRequest, proposal: RecoveryPlanProposal): Promise<RecoveryPlanReview>
}
