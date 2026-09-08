import type { NodeSnapshot, ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type { RecoveryPlanApprovalResult } from '../approval/RecoveryPlanApprovalHandler.js'
import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { InMemoryIncidentRepository } from '../incident/repository/InMemoryIncidentRepository.js'
import type { RecoveryPlan } from '../plan/RecoveryPlan.js'
import type { RecoveryPlanControl } from '../plan/RecoveryPlanControl.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import type { RecoveryOperationGate } from '../recovery/RecoveryOperationGate.js'
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
  private readonly planControl: RecoveryPlanControl
  private readonly operationGate: RecoveryOperationGate

  public constructor(
    gateways: readonly INodeAgentGateway[],
    policies: readonly ServiceRecoveryPolicy[],
    recoveryOrchestrator: RecoveryOrchestrator,
    incidentRepository: InMemoryIncidentRepository,
    planControl: RecoveryPlanControl,
    operationGate: RecoveryOperationGate,
  ) {
    this.gateways = [...gateways]
    this.policies = [...policies]
    this.recoveryOrchestrator = recoveryOrchestrator
    this.incidentRepository = incidentRepository
    this.planControl = planControl
    this.operationGate = operationGate
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
    const gateway = this.requireGateway(nodeId)
    return this.operationGate.run(
      nodeId,
      serviceId,
      () => this.recoverOrRespectPendingPlan(gateway, policy),
    )
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

  public listRecoveryPlans(): readonly RecoveryPlan[] {
    return this.planControl.list()
  }

  public inspectRecoveryPlan(planId: string): RecoveryPlan {
    return this.planControl.inspect(planId)
  }

  public approveRecoveryPlan(planId: string, approvalToken: string): Promise<RecoveryPlanApprovalResult> {
    return this.planControl.approve(planId, approvalToken)
  }

  public rejectRecoveryPlan(planId: string, approvalToken: string, reason: string): RecoveryPlan {
    return this.planControl.reject(planId, approvalToken, reason)
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

  private async recoverOrRespectPendingPlan(
    gateway: INodeAgentGateway,
    policy: ServiceRecoveryPolicy,
  ): Promise<RecoveryRunResult> {
    const pendingPlan = this.planControl.findPending(policy.nodeId, policy.serviceId)
    if (pendingPlan === undefined) {
      return this.recoveryOrchestrator.recover(gateway, policy)
    }

    const snapshot = await gateway.inspectService(policy.serviceId)
    let incident = this.incidentRepository.require(pendingPlan.incidentId)

    if (snapshot.lifecycleState === policy.expectedState && snapshot.healthy) {
      const supersededPlan = this.planControl.supersede(
        pendingPlan.id,
        'Service recovered before approval; pending plan was not executed',
      )
      incident = this.incidentRepository.append(
        incident.id,
        'resolved',
        `Service recovered before approval; recovery plan ${pendingPlan.id} superseded without execution`,
        'resolved',
      )
      return {
        status: 'healthy',
        snapshot,
        incident,
        recoveryPlan: supersededPlan,
        restartAttempts: 0,
      }
    }

    return {
      status: 'approval_required',
      snapshot,
      incident,
      recoveryPlan: pendingPlan,
      restartAttempts: 0,
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
