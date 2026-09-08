import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type { InMemoryIncidentRepository } from '../incident/repository/InMemoryIncidentRepository.js'
import type { RecoveryPlanControl } from '../plan/RecoveryPlanControl.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import type { RecoveryOrchestrator } from '../recovery/RecoveryOrchestrator.js'
import type {
  RecoveryDependencyReadiness,
  RecoveryReadinessReport,
  RecoveryServiceReadiness,
} from './RecoveryReadiness.js'

export class RecoveryReadinessInspector {
  private readonly gateways: readonly INodeAgentGateway[]
  private readonly policies: readonly ServiceRecoveryPolicy[]
  private readonly recoveryOrchestrator: RecoveryOrchestrator
  private readonly incidentRepository: InMemoryIncidentRepository
  private readonly planControl: RecoveryPlanControl

  public constructor(
    gateways: readonly INodeAgentGateway[],
    policies: readonly ServiceRecoveryPolicy[],
    recoveryOrchestrator: RecoveryOrchestrator,
    incidentRepository: InMemoryIncidentRepository,
    planControl: RecoveryPlanControl,
  ) {
    this.gateways = [...gateways]
    this.policies = [...policies]
    this.recoveryOrchestrator = recoveryOrchestrator
    this.incidentRepository = incidentRepository
    this.planControl = planControl
  }

  public async inspect(): Promise<RecoveryReadinessReport> {
    const observedAt = new Date().toISOString()
    const services = await Promise.all(this.policies.map((policy) => this.inspectService(policy, observedAt)))
    return {
      observedAt,
      services,
      readyServices: services.filter((service) => service.status === 'ready').length,
      limitedServices: services.filter((service) => service.status === 'limited').length,
      blockedServices: services.filter((service) => service.status === 'blocked').length,
      unreachableServices: services.filter((service) => service.status === 'unreachable').length,
    }
  }

  private async inspectService(policy: ServiceRecoveryPolicy, observedAt: string): Promise<RecoveryServiceReadiness> {
    const automaticBudget = this.recoveryOrchestrator.inspectAutomaticRestartBudget(policy)
    const pendingPlan = this.planControl.findPending(policy.nodeId, policy.serviceId)
    const humanIncident = this.incidentRepository.findHumanRequired(policy.nodeId, policy.serviceId)
    const dependencyBlockedIncident = this.incidentRepository.findDependencyBlocked(policy.nodeId, policy.serviceId)
    const dependencies = await Promise.all((policy.dependencies ?? []).map((dependency) => this.inspectDependency(dependency.nodeId, dependency.serviceId)))

    let targetHealthy: boolean | undefined
    let targetError: string | undefined
    try {
      const target = await this.requireGateway(policy.nodeId).inspectService(policy.serviceId)
      targetHealthy = target.lifecycleState === policy.expectedState && target.healthy
    } catch (error: unknown) {
      targetError = this.message(error)
    }

    const dependencyProblems = dependencies.filter((dependency) => dependency.reachable === false || dependency.healthy === false)
    const reasons: string[] = []
    if (targetError !== undefined) reasons.push(`Target node/service is unreachable: ${targetError}`)
    if (!policy.restartAllowed) reasons.push('Automatic restart is disabled by policy')
    if (policy.maxRestartAttempts === 0) reasons.push('Automatic restart policy has zero allowed attempts')
    if (automaticBudget.remainingAttempts === 0 && policy.maxRestartAttempts > 0) {
      reasons.push(`Automatic restart budget is exhausted: ${automaticBudget.usedAttempts}/${automaticBudget.maximumAttempts} used in ${automaticBudget.windowMs}ms`)
    }
    if (dependencyProblems.length > 0) {
      reasons.push(`Dependency health blocks recovery: ${dependencyProblems.map((dependency) => `${dependency.nodeId}/${dependency.serviceId}`).join(', ')}`)
    }
    if (pendingPlan !== undefined) reasons.push(`Recovery plan ${pendingPlan.id} is awaiting explicit human approval`)
    if (humanIncident !== undefined) reasons.push(`Incident ${humanIncident.id} requires human intervention`)
    if (dependencyBlockedIncident !== undefined && dependencyProblems.length > 0) {
      reasons.push(`Incident ${dependencyBlockedIncident.id} is dependency-blocked`)
    }

    const targetReachable = targetError === undefined
    const humanApprovalRequired = pendingPlan !== undefined || humanIncident !== undefined
    const automaticRecoveryAvailable = targetReachable
      && dependencyProblems.length === 0
      && !humanApprovalRequired
      && policy.restartAllowed
      && automaticBudget.remainingAttempts > 0
    const status = !targetReachable
      ? 'unreachable'
      : dependencyProblems.length > 0 || humanApprovalRequired
        ? 'blocked'
        : automaticRecoveryAvailable
          ? 'ready'
          : 'limited'

    return {
      nodeId: policy.nodeId,
      serviceId: policy.serviceId,
      observedAt,
      status,
      targetReachable,
      ...(targetHealthy === undefined ? {} : { targetHealthy }),
      restartAllowed: policy.restartAllowed,
      automaticRecoveryAvailable,
      humanApprovalRequired,
      automaticBudget,
      dependencies,
      ...(pendingPlan === undefined ? {} : { pendingPlanId: pendingPlan.id }),
      ...(humanIncident === undefined ? {} : { humanIncidentId: humanIncident.id }),
      ...(dependencyBlockedIncident === undefined ? {} : { dependencyBlockedIncidentId: dependencyBlockedIncident.id }),
      reasons,
    }
  }

  private async inspectDependency(nodeId: string, serviceId: string): Promise<RecoveryDependencyReadiness> {
    const policy = this.requirePolicy(nodeId, serviceId)
    try {
      const snapshot = await this.requireGateway(nodeId).inspectService(serviceId)
      return {
        nodeId,
        serviceId,
        reachable: true,
        healthy: snapshot.lifecycleState === policy.expectedState && snapshot.healthy,
        detail: snapshot.detail,
      }
    } catch (error: unknown) {
      return { nodeId, serviceId, reachable: false, error: this.message(error) }
    }
  }

  private requireGateway(nodeId: string): INodeAgentGateway {
    const gateway = this.gateways.find((candidate) => candidate.nodeId === nodeId)
    if (gateway === undefined) throw new Error(`Unknown recovery node: ${nodeId}`)
    return gateway
  }

  private requirePolicy(nodeId: string, serviceId: string): ServiceRecoveryPolicy {
    const policy = this.policies.find((candidate) => candidate.nodeId === nodeId && candidate.serviceId === serviceId)
    if (policy === undefined) throw new Error(`No recovery policy configured for ${nodeId}/${serviceId}`)
    return policy
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
