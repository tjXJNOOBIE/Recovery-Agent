import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type { RecoveryAutomaticRestartBudget } from '../budget/RecoveryAutomaticRestartBudget.js'
import type { InMemoryIncidentRepository } from '../incident/repository/InMemoryIncidentRepository.js'
import type { RecoveryPolicyResolver } from '../policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import type { RecoveryEscalationHandler } from '../plan/RecoveryEscalationHandler.js'
import type { RecoveryRunResult } from './RecoveryRunResult.js'

export class RecoveryOrchestrator {
  private readonly policyResolver: RecoveryPolicyResolver
  private readonly incidentRepository: InMemoryIncidentRepository
  private readonly escalationHandler: RecoveryEscalationHandler
  private readonly restartBudget: RecoveryAutomaticRestartBudget

  public constructor(
    policyResolver: RecoveryPolicyResolver,
    incidentRepository: InMemoryIncidentRepository,
    escalationHandler: RecoveryEscalationHandler,
    restartBudget: RecoveryAutomaticRestartBudget,
  ) {
    this.policyResolver = policyResolver
    this.incidentRepository = incidentRepository
    this.escalationHandler = escalationHandler
    this.restartBudget = restartBudget
  }

  public async recover(gateway: INodeAgentGateway, policy: ServiceRecoveryPolicy): Promise<RecoveryRunResult> {
    const initialSnapshot = await gateway.inspectService(policy.serviceId)
    const decision = this.policyResolver.resolve(initialSnapshot, policy)
    if (decision === 'healthy') {
      return { status: 'healthy', snapshot: initialSnapshot, restartAttempts: 0 }
    }

    let incident = this.incidentRepository.open(
      gateway.nodeId,
      policy.serviceId,
      `Service unhealthy: ${initialSnapshot.lifecycleState}; ${initialSnapshot.detail}`,
    )

    if (decision === 'human') {
      incident = this.incidentRepository.append(incident.id, 'escalated', 'State is unknown; automatic mutation refused', 'human_required')
      return { status: 'escalated', snapshot: initialSnapshot, incident, restartAttempts: 0 }
    }

    let currentSnapshot = initialSnapshot
    let restartAttempts = 0

    if (decision === 'restart') {
      for (let candidateAttempt = 1; candidateAttempt <= policy.maxRestartAttempts; candidateAttempt += 1) {
        const budgetDecision = this.restartBudget.tryConsume(policy)
        if (!budgetDecision.allowed) {
          const budget = budgetDecision.snapshot
          incident = this.incidentRepository.append(
            incident.id,
            'action',
            `Automatic restart budget exhausted: ${budget.usedAttempts}/${budget.maximumAttempts} attempt(s) used in ${budget.windowMs}ms; no restart executed`,
            'recovering',
          )
          break
        }

        restartAttempts += 1
        const budget = budgetDecision.snapshot
        incident = this.incidentRepository.append(
          incident.id,
          'action',
          `Restart attempt ${restartAttempts} requested; automatic rolling budget ${budget.usedAttempts}/${budget.maximumAttempts} in ${budget.windowMs}ms`,
          'recovering',
        )
        const actionResult = await gateway.restartService(policy.serviceId)
        currentSnapshot = await gateway.inspectService(policy.serviceId)
        incident = this.incidentRepository.append(
          incident.id,
          'verification',
          `Restart accepted=${actionResult.accepted}; verified ${currentSnapshot.lifecycleState}; healthy=${currentSnapshot.healthy}`,
          'recovering',
        )
        if (currentSnapshot.lifecycleState === policy.expectedState && currentSnapshot.healthy) {
          incident = this.incidentRepository.append(incident.id, 'resolved', 'Deterministic restart restored service health', 'resolved')
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
