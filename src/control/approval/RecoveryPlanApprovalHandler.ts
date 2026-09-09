import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { RecoveryIncidentRuntimeState } from '../incident/runtime/RecoveryIncidentRuntimeState.js'
import type { RecoveryPlan } from '../plan/RecoveryPlan.js'
import type { RecoveryPlanRuntimeState } from '../plan/runtime/RecoveryPlanRuntimeState.js'
import type { ApprovedRecoveryExecutor } from './ApprovedRecoveryExecutor.js'
import type { RecoveryApprovalVerifier } from './RecoveryApprovalVerifier.js'

export interface RecoveryPlanApprovalResult {
  readonly plan: RecoveryPlan
  readonly incident: IncidentRecord
  readonly snapshot: ServiceSnapshot
  readonly restoredHealth: boolean
}

export class RecoveryPlanApprovalHandler {
  private readonly planState: RecoveryPlanRuntimeState
  private readonly incidentState: RecoveryIncidentRuntimeState
  private readonly approvalVerifier: RecoveryApprovalVerifier
  private readonly executor: ApprovedRecoveryExecutor

  public constructor(
    planState: RecoveryPlanRuntimeState,
    incidentState: RecoveryIncidentRuntimeState,
    approvalVerifier: RecoveryApprovalVerifier,
    executor: ApprovedRecoveryExecutor,
  ) {
    this.planState = planState
    this.incidentState = incidentState
    this.approvalVerifier = approvalVerifier
    this.executor = executor
  }

  public async approveAndExecute(planId: string, approvalToken: string): Promise<RecoveryPlanApprovalResult> {
    this.approvalVerifier.verify(approvalToken)
    let plan = this.planState.transition(planId, 'pending_approval', 'approved')
    let incident = this.incidentState.append(
      plan.incidentId,
      'approval',
      `Recovery plan ${plan.id} received explicit out-of-band approval`,
      'recovering',
    )

    try {
      const execution = await this.executor.execute(plan)
      incident = this.incidentState.append(
        incident.id,
        'plan_execution',
        `Approved restart accepted=${execution.accepted}; verified ${execution.snapshot.lifecycleState}; healthy=${execution.snapshot.healthy}`,
        'recovering',
      )
      if (execution.restoredHealth) {
        plan = this.planState.transition(plan.id, 'approved', 'executed', 'Approved restart restored service health')
        incident = this.incidentState.append(
          incident.id,
          'resolved',
          'Explicitly approved recovery plan restored service health',
          'resolved',
        )
      } else {
        plan = this.planState.transition(plan.id, 'approved', 'failed', 'Approved restart did not restore service health')
        incident = this.incidentState.append(
          incident.id,
          'escalated',
          'Approved recovery plan executed but service remains unhealthy',
          'human_required',
        )
      }
      return { plan, incident, snapshot: execution.snapshot, restoredHealth: execution.restoredHealth }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      plan = this.planState.transition(plan.id, 'approved', 'failed', `Approved action failed: ${message}`)
      this.incidentState.append(
        incident.id,
        'escalated',
        `Approved recovery execution failed: ${message}`,
        'human_required',
      )
      throw error
    }
  }

  public reject(planId: string, approvalToken: string, reason: string): RecoveryPlan {
    this.approvalVerifier.verify(approvalToken)
    const normalizedReason = reason.trim()
    if (normalizedReason.length === 0) {
      throw new Error('Recovery plan rejection reason must be non-blank')
    }
    const plan = this.planState.transition(planId, 'pending_approval', 'rejected', normalizedReason)
    this.incidentState.append(
      plan.incidentId,
      'approval',
      `Recovery plan ${plan.id} was explicitly rejected: ${normalizedReason}`,
      'human_required',
    )
    return plan
  }
}
