import type { RecoveryPlanApprovalHandler, RecoveryPlanApprovalResult } from '../approval/RecoveryPlanApprovalHandler.js'
import type { InMemoryRecoveryPlanRepository } from './InMemoryRecoveryPlanRepository.js'
import type { RecoveryPlan } from './RecoveryPlan.js'

export class RecoveryPlanControl {
  private readonly repository: InMemoryRecoveryPlanRepository
  private readonly approvalHandler: RecoveryPlanApprovalHandler

  public constructor(repository: InMemoryRecoveryPlanRepository, approvalHandler: RecoveryPlanApprovalHandler) {
    this.repository = repository
    this.approvalHandler = approvalHandler
  }

  public list(): readonly RecoveryPlan[] {
    return this.repository.list()
  }

  public inspect(planId: string): RecoveryPlan {
    return this.repository.require(planId)
  }

  public approve(planId: string, approvalToken: string): Promise<RecoveryPlanApprovalResult> {
    return this.approvalHandler.approveAndExecute(planId, approvalToken)
  }

  public reject(planId: string, approvalToken: string, reason: string): RecoveryPlan {
    return this.approvalHandler.reject(planId, approvalToken, reason)
  }
}
