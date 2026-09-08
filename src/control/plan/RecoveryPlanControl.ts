import type { RecoveryPlanApprovalHandler, RecoveryPlanApprovalResult } from '../approval/RecoveryPlanApprovalHandler.js'
import type { RecoveryPlan } from './RecoveryPlan.js'
import type { RecoveryPlanRuntimeState } from './runtime/RecoveryPlanRuntimeState.js'

export class RecoveryPlanControl {
  private readonly planState: RecoveryPlanRuntimeState
  private readonly approvalHandler: RecoveryPlanApprovalHandler

  public constructor(planState: RecoveryPlanRuntimeState, approvalHandler: RecoveryPlanApprovalHandler) {
    this.planState = planState
    this.approvalHandler = approvalHandler
  }

  public restore(plans: readonly RecoveryPlan[]): void {
    this.planState.restore(plans)
  }

  public list(): readonly RecoveryPlan[] {
    return this.planState.list()
  }

  public inspect(planId: string): RecoveryPlan {
    return this.planState.require(planId)
  }

  public findPending(nodeId: string, serviceId: string): RecoveryPlan | undefined {
    return this.planState.findPending(nodeId, serviceId)
  }

  public supersede(planId: string, outcome: string): RecoveryPlan {
    return this.planState.transition(planId, 'pending_approval', 'superseded', outcome)
  }

  public approve(planId: string, approvalToken: string): Promise<RecoveryPlanApprovalResult> {
    return this.approvalHandler.approveAndExecute(planId, approvalToken)
  }

  public reject(planId: string, approvalToken: string, reason: string): Promise<RecoveryPlan> {
    return this.approvalHandler.reject(planId, approvalToken, reason)
  }
}
