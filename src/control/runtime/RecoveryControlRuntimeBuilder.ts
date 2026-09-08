import type { IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/custom-strands-bridge'

import { RecoveryAgentRuntimeConfigBuilder, type RecoveryAgentEnvironment } from '../../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { RecoveryControlConfig } from '../../config/RecoveryControlConfig.js'
import { HttpNodeAgentGateway } from '../../node/http/HttpNodeAgentGateway.js'
import { InMemoryIncidentRepository } from '../incident/repository/InMemoryIncidentRepository.js'
import { StrandsRecoveryInvestigator } from '../investigation/StrandsRecoveryInvestigator.js'
import { RecoveryPolicyResolver } from '../policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import { RecoveryOrchestrator } from '../recovery/RecoveryOrchestrator.js'
import { RecoveryControlRuntime } from './RecoveryControlRuntime.js'

export class RecoveryControlRuntimeBuilder {
  private readonly bootstrap: IStrandsAgentRuntimeBootstrap
  private readonly environment: RecoveryAgentEnvironment

  public constructor(bootstrap: IStrandsAgentRuntimeBootstrap, environment: RecoveryAgentEnvironment = process.env) {
    this.bootstrap = bootstrap
    this.environment = environment
  }

  public build(config: RecoveryControlConfig): RecoveryControlRuntime {
    const gateways = config.nodes.map((node) => new HttpNodeAgentGateway(node.id, node.baseUrl, this.requireSecret(node.tokenEnvironmentVariable)))
    const policies: ServiceRecoveryPolicy[] = config.nodes.flatMap((node) => node.services.map((service) => ({
      nodeId: node.id,
      serviceId: service.id,
      expectedState: 'running' as const,
      restartAllowed: service.restartAllowed,
      maxRestartAttempts: service.maxRestartAttempts,
    })))
    const incidentRepository = new InMemoryIncidentRepository()
    const investigator = new StrandsRecoveryInvestigator(this.bootstrap, new RecoveryAgentRuntimeConfigBuilder(this.environment))
    return new RecoveryControlRuntime(
      gateways,
      policies,
      new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidentRepository, investigator),
      incidentRepository,
    )
  }

  private requireSecret(environmentVariable: string): string {
    const value = this.environment[environmentVariable]?.trim()
    if (value === undefined || value.length < 16) throw new Error(`Environment variable ${environmentVariable} must contain a node token of at least 16 characters`)
    return value
  }
}
