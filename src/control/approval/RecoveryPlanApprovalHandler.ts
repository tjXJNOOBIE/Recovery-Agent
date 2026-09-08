import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { IRecoveryDurabilityCheckpoint } from '../durability/RecoveryDurabilityCheckpointBarrier.js'
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
  private readonly durabilityCheckpoint: IRecoveryDurabilityCheckpoint | undefined

  public constructor(
    planState: RecoveryPlanRuntimeState,
    incidentState: RecoveryIncidentRuntimeState,
    approvalVerifier: RecoveryApprovalVerifier,
    executor: ApprovedRecoveryExecutor,
    durabilityCheckpoint?: IRecoveryDurabilityCheckpoint,
  ) {
    this.planState = planState
    this.incidentState = incidentState
    this.approvalVerifier = approvalVerifier
    this.executor = executor
    this.durabilityCheckpoint = durabilityCheckpoint
  }

  public async approveAndExecute(planId: string, approvalToken: string): Promise<RecoveryPlanApprovalResult> {
    this.approvalVerifier.verify(approvalToken)
    this.durabilityCheckpoint?.assertMutationAllowed()
    let plan = this.planState.transition(planId, 'pending_approval', 'approved')
    let incident = this.incidentState.append(
      plan.incidentId,
      'approval',
      `Recovery plan ${plan.id} received explicit out-of-band approval`,
      'recovering',
    )

    await this.durabilityCheckpoint?.checkpoint({
      actor: 'local-control-host',
      action: 'approved_restart_intent',
      summary: `Persisted approval for recovery plan ${plan.id} before executing its bound restart`,
      nodeId: plan.nodeId,
      serviceId: plan.serviceId,
    })

    let execution: Awaited<ReturnType<ApprovedRecoveryExecutor['execute']>>
    try {
      execution = await this.executor.execute(plan)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      plan = this.planState.transition(plan.id, 'approved', 'failed', `Approved action failed: ${message}`)
      incident = this.incidentState.append(
        incident.id,
        'escalated',
        `Approved recovery execution failed: ${message}`,
        'human_required',
      )
      try {
        await this.durabilityCheckpoint?.checkpoint({
          actor: 'recovery-agent',
          action: 'approved_restart_execution_failed',
          summary: `Approved recovery plan ${plan.id} failed during execution: ${message}`,
          nodeId: plan.nodeId,
          serviceId: plan.serviceId,
        })
      } catch (checkpointError: unknown) {
        throw new AggregateError(
          [error, checkpointError],
          'Approved recovery execution failed and the resulting failure state could not be checkpointed',
          { cause: error },
        )
      }
      throw error
    }

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

    await this.durabilityCheckpoint?.checkpoint({
      actor: 'recovery-agent',
      action: 'approved_restart_verified',
      summary: `Recovery plan ${plan.id} finished with status ${plan.status}; restoredHealth=${execution.restoredHealth}`,
      nodeId: plan.nodeId,
      serviceId: plan.serviceId,
    })
    return { plan, incident, snapshot: execution.snapshot, restoredHealth: execution.restoredHealth }
  }

  public async reject(planId: string, approvalToken: string, reason: string): Promise<RecoveryPlan> {
    this.approvalVerifier.verify(approvalToken)
    this.durabilityCheckpoint?.assertMutationAllowed()
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
    await this.durabilityCheckpoint?.checkpoint({
      actor: 'local-control-host',
      action: 'recovery_plan_rejected',
      summary: `Persisted explicit rejection for recovery plan ${plan.id}: ${normalizedReason}`,
      nodeId: plan.nodeId,
      serviceId: plan.serviceId,
    })
    return plan
  }
}
