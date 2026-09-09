import type { IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/strands-bridge'

import { RecoveryAgentRuntimeConfigBuilder, type RecoveryAgentEnvironment } from '../../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { RecoveryControlConfig } from '../../config/RecoveryControlConfig.js'
import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import { HttpNodeAgentGateway } from '../../node/http/HttpNodeAgentGateway.js'
import { ApprovedRecoveryExecutor } from '../approval/ApprovedRecoveryExecutor.js'
import { RecoveryApprovalVerifier } from '../approval/RecoveryApprovalVerifier.js'
import { RecoveryPlanApprovalHandler } from '../approval/RecoveryPlanApprovalHandler.js'
import { RecoveryAutomaticRestartBudget } from '../budget/RecoveryAutomaticRestartBudget.js'
import type { IRecoveryDurabilityCheckpoint } from '../durability/RecoveryDurabilityCheckpointBarrier.js'
import { RecoveryIncidentRuntimeState } from '../incident/runtime/RecoveryIncidentRuntimeState.js'
import { StrandsRecoveryInvestigator } from '../investigation/StrandsRecoveryInvestigator.js'
import { RecoveryPolicyResolver } from '../policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import { RecoveryEscalationHandler } from '../plan/RecoveryEscalationHandler.js'
import { RecoveryPlanControl } from '../plan/RecoveryPlanControl.js'
import { RecoveryPlanProposalParser } from '../plan/RecoveryPlanProposalParser.js'
import { RecoveryPlanReviewParser } from '../plan/RecoveryPlanReviewParser.js'
import { RecoveryPlanRuntimeState } from '../plan/runtime/RecoveryPlanRuntimeState.js'
import { StrandsRecoveryPlanCritic } from '../plan/StrandsRecoveryPlanCritic.js'
import { StrandsRecoveryPlanner } from '../plan/StrandsRecoveryPlanner.js'
import { RecoveryPostmortemParser } from '../postmortem/RecoveryPostmortemParser.js'
import { StrandsRecoveryPostmortem } from '../postmortem/StrandsRecoveryPostmortem.js'
import { RecoveryOperationGate } from '../recovery/RecoveryOperationGate.js'
import { RecoveryOrchestrator } from '../recovery/RecoveryOrchestrator.js'
import { RecoveryControlRuntime } from './RecoveryControlRuntime.js'

export class RecoveryControlRuntimeBuilder {
  private readonly bootstrap: IStrandsAgentRuntimeBootstrap
  private readonly environment: RecoveryAgentEnvironment
  private readonly durabilityCheckpoint: IRecoveryDurabilityCheckpoint | undefined

  public constructor(bootstrap: IStrandsAgentRuntimeBootstrap, environment: RecoveryAgentEnvironment = process.env, durabilityCheckpoint?: IRecoveryDurabilityCheckpoint) {
    this.bootstrap = bootstrap; this.environment = environment; this.durabilityCheckpoint = durabilityCheckpoint
  }

  public build(config: RecoveryControlConfig, suppliedGateways?: readonly INodeAgentGateway[]): RecoveryControlRuntime {
    const gateways = this.resolveGateways(config, suppliedGateways)
    const policies: ServiceRecoveryPolicy[] = config.nodes.flatMap((node) => node.services.map((service) => ({
      nodeId: node.id,
      serviceId: service.id,
      expectedState: 'running' as const,
      restartAllowed: service.restartAllowed,
      maxRestartAttempts: service.maxRestartAttempts,
      restartBudgetWindowMs: service.restartBudgetWindowSeconds * 1_000,
      dependencies: service.dependencies,
    })))
    const incidentState = new RecoveryIncidentRuntimeState()
    const planState = new RecoveryPlanRuntimeState()
    const agentConfigBuilder = new RecoveryAgentRuntimeConfigBuilder(this.environment)
    const investigator = new StrandsRecoveryInvestigator(this.bootstrap, agentConfigBuilder)
    const planner = new StrandsRecoveryPlanner(this.bootstrap, agentConfigBuilder, new RecoveryPlanProposalParser())
    const critic = new StrandsRecoveryPlanCritic(this.bootstrap, agentConfigBuilder, new RecoveryPlanReviewParser())
    const escalationHandler = new RecoveryEscalationHandler(incidentState, investigator, planner, planState, critic)
    const restartBudget = new RecoveryAutomaticRestartBudget()
    const orchestrator = new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidentState, escalationHandler, restartBudget, this.durabilityCheckpoint)
    const approvalHandler = new RecoveryPlanApprovalHandler(
      planState,
      incidentState,
      RecoveryApprovalVerifier.fromConfig(config.approvalPrincipals, this.environment, this.environment['RECOVERY_APPROVAL_TOKEN']),
      new ApprovedRecoveryExecutor(gateways, policies),
      this.durabilityCheckpoint,
    )
    const postmortem = new StrandsRecoveryPostmortem(this.bootstrap, agentConfigBuilder, new RecoveryPostmortemParser())
    return new RecoveryControlRuntime(
      gateways,
      policies,
      orchestrator,
      incidentState,
      new RecoveryPlanControl(planState, approvalHandler),
      new RecoveryOperationGate(),
      undefined,
      postmortem,
      this.durabilityCheckpoint,
    )
  }

  private resolveGateways(config: RecoveryControlConfig, suppliedGateways: readonly INodeAgentGateway[] | undefined): readonly INodeAgentGateway[] {
    if (suppliedGateways !== undefined) {
      const byNode = new Map<string, INodeAgentGateway>()
      for (const gateway of suppliedGateways) {
        if (byNode.has(gateway.nodeId)) throw new Error(`Duplicate Recovery node gateway for ${gateway.nodeId}`)
        byNode.set(gateway.nodeId, gateway)
      }
      const configured = new Set(config.nodes.map((node) => node.id))
      for (const nodeId of byNode.keys()) if (!configured.has(nodeId)) throw new Error(`Recovery node gateway ${nodeId} is not present in control config`)
      return config.nodes.map((node) => {
        const gateway = byNode.get(node.id)
        if (gateway === undefined) throw new Error(`Recovery control config node ${node.id} has no supplied gateway`)
        return gateway
      })
    }

    if (config.transport.mode !== 'loopback_http') throw new Error('outbound_tls Recovery control runtime requires explicit session-backed node gateways')
    return config.nodes.map((node) => new HttpNodeAgentGateway(
      node.id,
      this.requireNodeConfigValue(node.baseUrl, `Recovery loopback node ${node.id} baseUrl`),
      this.requireSecret(this.requireNodeConfigValue(node.tokenEnvironmentVariable, `Recovery loopback node ${node.id} tokenEnvironmentVariable`)),
    ))
  }

  private requireNodeConfigValue(value: string | undefined, label: string): string {
    if (value === undefined || value.trim().length === 0) throw new Error(`${label} must be configured`)
    return value
  }

  private requireSecret(environmentVariable: string): string {
    const value = this.environment[environmentVariable]?.trim()
    if (value === undefined || value.length < 16) throw new Error(`Environment variable ${environmentVariable} must contain a node token of at least 16 characters`)
    return value
  }
}
