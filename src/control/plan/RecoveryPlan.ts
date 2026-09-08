export type RecoveryPlanActionType = 'restart_service'
export type RecoveryPlanRisk = 'elevated'
export type RecoveryPlanStatus = 'pending_approval' | 'approved' | 'executed' | 'rejected' | 'failed'

export interface RecoveryPlanAction {
  readonly type: RecoveryPlanActionType
}

export interface RecoveryPlan {
  readonly id: string
  readonly incidentId: string
  readonly nodeId: string
  readonly serviceId: string
  readonly action: RecoveryPlanAction
  readonly rationale: string
  readonly risk: RecoveryPlanRisk
  readonly status: RecoveryPlanStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly outcome?: string
}

export interface RecoveryPlanProposal {
  readonly action: RecoveryPlanActionType | 'none'
  readonly rationale: string
}
