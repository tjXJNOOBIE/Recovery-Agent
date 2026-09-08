import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
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

    const policy = this.policies.find((candidate) => candidate.nodeId === plan.nodeId && candidate.serviceId === plan.serviceId)
    if (policy === undefined) {
      throw new Error(`No recovery policy configured for ${plan.nodeId}/${plan.serviceId}`)
    }
    if (!policy.restartAllowed) {
      throw new Error(`Restart is not allowed for ${plan.nodeId}/${plan.serviceId}`)
    }

    const gateway = this.gateways.find((candidate) => candidate.nodeId === plan.nodeId)
    if (gateway === undefined) {
      throw new Error(`Unknown recovery node: ${plan.nodeId}`)
    }

    const actionResult = await gateway.restartService(plan.serviceId)
    const snapshot = await gateway.inspectService(plan.serviceId)
    return {
      accepted: actionResult.accepted,
      snapshot,
      restoredHealth: snapshot.lifecycleState === policy.expectedState && snapshot.healthy,
    }
  }
}
