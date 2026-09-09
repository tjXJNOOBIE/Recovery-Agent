import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type { RecoveryServiceDependency, ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import type { RecoveryPlan } from '../plan/RecoveryPlan.js'

export interface ApprovedRecoveryExecutionResult {
  readonly accepted: boolean
  readonly snapshot: ServiceSnapshot
  readonly restoredHealth: boolean
}

export class ApprovedRecoveryExecutor {
  private readonly gateways: readonly INodeAgentGateway[]
  private readonly policies: readonly ServiceRecoveryPolicy[]

  public constructor(gateways: readonly INodeAgentGateway[], policies: readonly ServiceRecoveryPolicy[]) {
    this.gateways = [...gateways]
    this.policies = [...policies]
  }

  public async execute(plan: RecoveryPlan): Promise<ApprovedRecoveryExecutionResult> {
    if (plan.action.type !== 'restart_service') {
      throw new Error(`Unsupported approved recovery action: ${plan.action.type}`)
    }

    const policy = this.requirePolicy(plan.nodeId, plan.serviceId)
    if (!policy.restartAllowed) throw new Error(`Restart is not allowed for ${plan.nodeId}/${plan.serviceId}`)

    const unhealthyDependencies = await this.inspectUnhealthyDependencies(policy.dependencies ?? [])
    if (unhealthyDependencies.length > 0) {
      throw new Error(`Approved restart blocked by unhealthy dependencies: ${unhealthyDependencies.join(', ')}`)
    }

    const gateway = this.requireGateway(plan.nodeId)
    const actionResult = await gateway.restartService(plan.serviceId)
    const snapshot = await gateway.inspectService(plan.serviceId)
    return {
      accepted: actionResult.accepted,
      snapshot,
      restoredHealth: snapshot.lifecycleState === policy.expectedState && snapshot.healthy,
    }
  }

  private async inspectUnhealthyDependencies(dependencies: readonly RecoveryServiceDependency[]): Promise<readonly string[]> {
    const results = await Promise.all(dependencies.map(async (dependency) => {
      const policy = this.requirePolicy(dependency.nodeId, dependency.serviceId)
      const snapshot = await this.requireGateway(dependency.nodeId).inspectService(dependency.serviceId)
      return snapshot.lifecycleState === policy.expectedState && snapshot.healthy
        ? undefined
        : `${dependency.nodeId}/${dependency.serviceId}`
    }))
    return results.filter((value): value is string => value !== undefined)
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
}
