import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type {
  RecoveryAutomaticRestartAttempt,
  RecoveryAutomaticRestartBudget,
  RecoveryAutomaticRestartBudgetSnapshot,
} from '../budget/RecoveryAutomaticRestartBudget.js'
import type { IRecoveryDurabilityCheckpoint } from '../durability/RecoveryDurabilityCheckpointBarrier.js'
import type { RecoveryIncidentRuntimeState } from '../incident/runtime/RecoveryIncidentRuntimeState.js'
import type { RecoveryPolicyResolver } from '../policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import type { RecoveryEscalationHandler } from '../plan/RecoveryEscalationHandler.js'
import type { RecoveryRunResult } from './RecoveryRunResult.js'

export class RecoveryOrchestrator {
  private readonly policyResolver: RecoveryPolicyResolver
  private readonly incidentState: RecoveryIncidentRuntimeState
  private readonly escalationHandler: RecoveryEscalationHandler
  private readonly restartBudget: RecoveryAutomaticRestartBudget
  private readonly durabilityCheckpoint: IRecoveryDurabilityCheckpoint | undefined

  public constructor(
    policyResolver: RecoveryPolicyResolver,
    incidentState: RecoveryIncidentRuntimeState,
    escalationHandler: RecoveryEscalationHandler,
    restartBudget: RecoveryAutomaticRestartBudget,
    durabilityCheckpoint?: IRecoveryDurabilityCheckpoint,
  ) {
    this.policyResolver = policyResolver
    this.incidentState = incidentState
    this.escalationHandler = escalationHandler
    this.restartBudget = restartBudget
    this.durabilityCheckpoint = durabilityCheckpoint
  }

  public inspectAutomaticRestartBudget(policy: ServiceRecoveryPolicy): RecoveryAutomaticRestartBudgetSnapshot {
    return this.restartBudget.inspect(policy)
  }

  public restoreAutomaticRestartAttempts(attempts: readonly RecoveryAutomaticRestartAttempt[]): void {
    this.restartBudget.restoreAttempts(attempts)
  }

  public listAutomaticRestartAttempts(): readonly RecoveryAutomaticRestartAttempt[] {
    return this.restartBudget.listAttempts()
  }

  public async recover(gateway: INodeAgentGateway, policy: ServiceRecoveryPolicy): Promise<RecoveryRunResult> {
    const initialSnapshot = await gateway.inspectService(policy.serviceId)
    const decision = this.policyResolver.resolve(initialSnapshot, policy)
    if (decision === 'healthy') {
      return { status: 'healthy', snapshot: initialSnapshot, restartAttempts: 0 }
    }

    this.durabilityCheckpoint?.assertMutationAllowed()
    let incident = this.incidentState.open(
      gateway.nodeId,
      policy.serviceId,
      `Service unhealthy: ${initialSnapshot.lifecycleState}; ${initialSnapshot.detail}`,
    )

    if (decision === 'human') {
      incident = this.incidentState.append(incident.id, 'escalated', 'State is unknown; automatic mutation refused', 'human_required')
      return { status: 'escalated', snapshot: initialSnapshot, incident, restartAttempts: 0 }
    }

    let currentSnapshot = initialSnapshot
    let restartAttempts = 0

    if (decision === 'restart') {
      for (let candidateAttempt = 1; candidateAttempt <= policy.maxRestartAttempts; candidateAttempt += 1) {
        const budgetDecision = this.restartBudget.tryConsume(policy)
        if (!budgetDecision.allowed) {
          const budget = budgetDecision.snapshot
          incident = this.incidentState.append(
            incident.id,
            'action',
            `Automatic restart budget exhausted: ${budget.usedAttempts}/${budget.maximumAttempts} attempt(s) used in ${budget.windowMs}ms; no restart executed`,
            'recovering',
          )
          break
        }

        restartAttempts += 1
        const budget = budgetDecision.snapshot
        incident = this.incidentState.append(
          incident.id,
          'action',
          `Restart attempt ${restartAttempts} requested; automatic rolling budget ${budget.usedAttempts}/${budget.maximumAttempts} in ${budget.windowMs}ms`,
          'recovering',
        )
        await this.durabilityCheckpoint?.checkpoint({
          actor: 'recovery-agent',
          action: 'automatic_restart_intent',
          summary: `Persisted automatic restart attempt ${restartAttempts} before executing the node mutation`,
          nodeId: policy.nodeId,
          serviceId: policy.serviceId,
        })

        const actionResult = await gateway.restartService(policy.serviceId)
        currentSnapshot = await gateway.inspectService(policy.serviceId)
        incident = this.incidentState.append(
          incident.id,
          'verification',
          `Restart accepted=${actionResult.accepted}; verified ${currentSnapshot.lifecycleState}; healthy=${currentSnapshot.healthy}`,
          'recovering',
        )
        if (currentSnapshot.lifecycleState === policy.expectedState && currentSnapshot.healthy) {
          incident = this.incidentState.append(incident.id, 'resolved', 'Deterministic restart restored service health', 'resolved')
          return { status: 'recovered', snapshot: currentSnapshot, incident, restartAttempts }
        }
      }
    }

    const escalation = await this.escalationHandler.investigateAndPlan({
      incident,
      before: initialSnapshot,
      afterAttempts: currentSnapshot,
      attempts: restartAttempts,
    })
    return {
      status: escalation.plan === undefined ? 'escalated' : 'approval_required',
      snapshot: currentSnapshot,
      incident: escalation.incident,
      investigationSummary: escalation.investigationSummary,
      ...(escalation.plan === undefined ? {} : { recoveryPlan: escalation.plan }),
      restartAttempts,
    }
  }
}
