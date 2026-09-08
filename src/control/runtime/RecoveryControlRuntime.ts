import type { NodeSnapshot, ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { InMemoryIncidentRepository } from '../incident/repository/InMemoryIncidentRepository.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import type { RecoveryOrchestrator } from '../recovery/RecoveryOrchestrator.js'
import type { RecoveryRunResult } from '../recovery/RecoveryRunResult.js'

export interface FleetStatusResult {
  readonly nodes: readonly NodeSnapshot[]
  readonly healthyServices: number
  readonly unhealthyServices: number
}

export class RecoveryControlRuntime {
  private readonly gateways: readonly INodeAgentGateway[]
  private readonly policies: readonly ServiceRecoveryPolicy[]
  private readonly recoveryOrchestrator: RecoveryOrchestrator
  private readonly incidentRepository: InMemoryIncidentRepository

  public constructor(
    gateways: readonly INodeAgentGateway[],
    policies: readonly ServiceRecoveryPolicy[],
    recoveryOrchestrator: RecoveryOrchestrator,
    incidentRepository: InMemoryIncidentRepository,
  ) {
    this.gateways = [...gateways]
    this.policies = [...policies]
    this.recoveryOrchestrator = recoveryOrchestrator
    this.incidentRepository = incidentRepository
  }

  public async fleetStatus(): Promise<FleetStatusResult> {
    const nodes = await Promise.all(this.gateways.map((gateway) => gateway.inspectNode()))
    const services = nodes.flatMap((node) => node.services)
    return {
      nodes,
      healthyServices: services.filter((service) => service.healthy).length,
      unhealthyServices: services.filter((service) => !service.healthy).length,
    }
  }

  public inspectService(nodeId: string, serviceId: string): Promise<ServiceSnapshot> {
    return this.requireGateway(nodeId).inspectService(serviceId)
  }

  public recoverService(nodeId: string, serviceId: string): Promise<RecoveryRunResult> {
    const policy = this.requirePolicy(nodeId, serviceId)
    return this.recoveryOrchestrator.recover(this.requireGateway(nodeId), policy)
  }

  public async healthSweep(): Promise<readonly RecoveryRunResult[]> {
    const fleet = await this.fleetStatus()
    const unhealthy = fleet.nodes.flatMap((node) => node.services).filter((service) => !service.healthy)
    const results: RecoveryRunResult[] = []
    for (const service of unhealthy) {
      results.push(await this.recoverService(service.nodeId, service.serviceId))
    }
    return results
  }

  public listIncidents(): readonly IncidentRecord[] {
    return this.incidentRepository.list()
  }

  public inspectIncident(incidentId: string): IncidentRecord {
    return this.incidentRepository.require(incidentId)
  }

  public async close(): Promise<void> {
    const failures: unknown[] = []
    for (const gateway of [...this.gateways].reverse()) {
      try {
        await gateway.close()
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to close one or more node gateways')
    }
  }

  private requireGateway(nodeId: string): INodeAgentGateway {
    const gateway = this.gateways.find((candidate) => candidate.nodeId === nodeId)
    if (gateway === undefined) {
      throw new Error(`Unknown recovery node: ${nodeId}`)
    }
    return gateway
  }

  private requirePolicy(nodeId: string, serviceId: string): ServiceRecoveryPolicy {
    const policy = this.policies.find((candidate) => candidate.nodeId === nodeId && candidate.serviceId === serviceId)
    if (policy === undefined) {
      throw new Error(`No recovery policy configured for ${nodeId}/${serviceId}`)
    }
    return policy
  }
}
