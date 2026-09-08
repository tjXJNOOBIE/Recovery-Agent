import type { NodeSnapshot, ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type { RecoveryPlanApprovalResult } from '../approval/RecoveryPlanApprovalHandler.js'
import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { InMemoryIncidentRepository } from '../incident/repository/InMemoryIncidentRepository.js'
import type { RecoveryPlan } from '../plan/RecoveryPlan.js'
import type { RecoveryPlanControl } from '../plan/RecoveryPlanControl.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import type { RecoveryReadinessReport } from '../readiness/RecoveryReadiness.js'
import { RecoveryReadinessInspector } from '../readiness/RecoveryReadinessInspector.js'
import type { RecoveryOperationGate } from '../recovery/RecoveryOperationGate.js'
import type { RecoveryOrchestrator } from '../recovery/RecoveryOrchestrator.js'
import type { RecoveryRunResult } from '../recovery/RecoveryRunResult.js'

export interface UnreachableNodeObservation {
  readonly nodeId: string
  readonly error: string
}

export interface FleetStatusResult {
  readonly nodes: readonly NodeSnapshot[]
  readonly unreachableNodes: readonly UnreachableNodeObservation[]
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
  private readonly readinessInspector: RecoveryReadinessInspector

  public constructor(
    gateways: readonly INodeAgentGateway[],
    policies: readonly ServiceRecoveryPolicy[],
    recoveryOrchestrator: RecoveryOrchestrator,
    incidentRepository: InMemoryIncidentRepository,
    planControl: RecoveryPlanControl,
    operationGate: RecoveryOperationGate,
    readinessInspector?: RecoveryReadinessInspector,
  ) {
    this.gateways = [...gateways]
    this.policies = [...policies]
    this.recoveryOrchestrator = recoveryOrchestrator
    this.incidentRepository = incidentRepository
    this.planControl = planControl
    this.operationGate = operationGate
    this.readinessInspector = readinessInspector ?? new RecoveryReadinessInspector(
      this.gateways,
      this.policies,
      this.recoveryOrchestrator,
      this.incidentRepository,
      this.planControl,
    )
  }

  public async fleetStatus(): Promise<FleetStatusResult> {
    const observations = await Promise.all(this.gateways.map(async (gateway) => {
      try {
        return { nodeId: gateway.nodeId, snapshot: await gateway.inspectNode() }
      } catch (error: unknown) {
        return { nodeId: gateway.nodeId, error: this.errorMessage(error) }
      }
    }))
    const nodes = observations.flatMap((observation) => 'snapshot' in observation ? [observation.snapshot] : [])
    const unreachableNodes = observations.flatMap((observation) =>
      'error' in observation ? [{ nodeId: observation.nodeId, error: observation.error }] : []
    )
    const services = nodes.flatMap((node) => node.services)
    return {
      nodes,
      unreachableNodes,
      healthyServices: services.filter((service) => service.healthy).length,
      unhealthyServices: services.filter((service) => !service.healthy).length,
    }
  }

  public inspectNode(nodeId: string): Promise<NodeSnapshot> {
    return this.requireGateway(nodeId).inspectNode()
  }

  public inspectService(nodeId: string, serviceId: string): Promise<ServiceSnapshot> {
    return this.requireGateway(nodeId).inspectService(serviceId)
  }

  public inspectRecoveryReadiness(): Promise<RecoveryReadinessReport> {
    return this.readinessInspector.inspect()
  }

  public recoverService(nodeId: string, serviceId: string): Promise<RecoveryRunResult> {
    const policy = this.requirePolicy(nodeId, serviceId)
    const gateway = this.requireGateway(nodeId)
    return this.operationGate.run(
      nodeId,
      serviceId,
      () => this.recoverOrRespectSuppression(gateway, policy),
    )
  }

  public async healthSweep(): Promise<readonly RecoveryRunResult[]> {
    const fleet = await this.fleetStatus()
    const unhealthyTargets = new Set(
      fleet.nodes.flatMap((node) => node.services)
        .filter((service) => !service.healthy)
        .map((service) => this.targetKey(service.nodeId, service.serviceId)),
    )
    const orderedPolicies = this.policies
      .filter((policy) => unhealthyTargets.has(this.targetKey(policy.nodeId, policy.serviceId)))
      .sort((left, right) => this.dependencyDepth(left) - this.dependencyDepth(right))

    const results: RecoveryRunResult[] = []
    for (const policy of orderedPolicies) {
      results.push(await this.recoverService(policy.nodeId, policy.serviceId))
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
    if (failures.length > 0) throw new AggregateError(failures, 'Failed to close one or more node gateways')
  }

  private async recoverOrRespectSuppression(
    gateway: INodeAgentGateway,
    policy: ServiceRecoveryPolicy,
  ): Promise<RecoveryRunResult> {
    const pendingPlan = this.planControl.findPending(policy.nodeId, policy.serviceId)
    if (pendingPlan !== undefined) {
      const snapshot = await gateway.inspectService(policy.serviceId)
      let incident = this.incidentRepository.require(pendingPlan.incidentId)
      if (this.isHealthy(snapshot, policy)) {
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
        return { status: 'healthy', snapshot, incident, recoveryPlan: supersededPlan, restartAttempts: 0 }
      }
      return { status: 'approval_required', snapshot, incident, recoveryPlan: pendingPlan, restartAttempts: 0 }
    }

    const humanRequiredIncident = this.incidentRepository.findHumanRequired(policy.nodeId, policy.serviceId)
    if (humanRequiredIncident !== undefined) {
      const snapshot = await gateway.inspectService(policy.serviceId)
      if (this.isHealthy(snapshot, policy)) {
        const resolved = this.incidentRepository.append(
          humanRequiredIncident.id,
          'resolved',
          'Service recovered while awaiting human intervention; no additional automatic recovery executed',
          'resolved',
        )
        return { status: 'healthy', snapshot, incident: resolved, restartAttempts: 0 }
      }
      return { status: 'escalated', snapshot, incident: humanRequiredIncident, restartAttempts: 0 }
    }

    const targetSnapshot = await gateway.inspectService(policy.serviceId)
    const dependencyBlockedIncident = this.incidentRepository.findDependencyBlocked(policy.nodeId, policy.serviceId)
    if (this.isHealthy(targetSnapshot, policy)) {
      if (dependencyBlockedIncident !== undefined) {
        const resolved = this.incidentRepository.append(
          dependencyBlockedIncident.id,
          'resolved',
          'Target service recovered while dependency block was active; no recovery mutation executed',
          'resolved',
        )
        return { status: 'healthy', snapshot: targetSnapshot, incident: resolved, restartAttempts: 0 }
      }
      return { status: 'healthy', snapshot: targetSnapshot, restartAttempts: 0 }
    }

    const unhealthyDependencies = await this.inspectUnhealthyDependencies(policy)
    if (unhealthyDependencies.length > 0) {
      if (dependencyBlockedIncident !== undefined) {
        return { status: 'blocked', snapshot: targetSnapshot, incident: dependencyBlockedIncident, restartAttempts: 0 }
      }
      const dependencyNames = unhealthyDependencies.map((snapshot) => this.targetKey(snapshot.nodeId, snapshot.serviceId)).join(', ')
      let incident = this.incidentRepository.open(
        policy.nodeId,
        policy.serviceId,
        `Service unhealthy but automatic recovery is blocked by unhealthy dependencies: ${dependencyNames}`,
      )
      incident = this.incidentRepository.append(
        incident.id,
        'dependency',
        `Dependency health gate blocked mutation: ${dependencyNames}`,
        'dependency_blocked',
      )
      return { status: 'blocked', snapshot: targetSnapshot, incident, restartAttempts: 0 }
    }

    if (dependencyBlockedIncident !== undefined) {
      this.incidentRepository.append(
        dependencyBlockedIncident.id,
        'resolved',
        'All declared dependencies recovered; dependency block cleared before target recovery resumed',
        'resolved',
      )
    }

    return this.recoveryOrchestrator.recover(gateway, policy)
  }

  private async inspectUnhealthyDependencies(policy: ServiceRecoveryPolicy): Promise<readonly ServiceSnapshot[]> {
    const snapshots = await Promise.all((policy.dependencies ?? []).map(async (dependency) => {
      const dependencyPolicy = this.requirePolicy(dependency.nodeId, dependency.serviceId)
      const snapshot = await this.requireGateway(dependency.nodeId).inspectService(dependency.serviceId)
      return { snapshot, dependencyPolicy }
    }))
    return snapshots
      .filter(({ snapshot, dependencyPolicy }) => !this.isHealthy(snapshot, dependencyPolicy))
      .map(({ snapshot }) => snapshot)
  }

  private dependencyDepth(policy: ServiceRecoveryPolicy, visiting: ReadonlySet<string> = new Set()): number {
    const key = this.targetKey(policy.nodeId, policy.serviceId)
    if (visiting.has(key)) throw new Error(`Recovery dependency cycle reached runtime at ${key}`)
    const dependencies = policy.dependencies ?? []
    if (dependencies.length === 0) return 0
    const nextVisiting = new Set(visiting)
    nextVisiting.add(key)
    return 1 + Math.max(...dependencies.map((dependency) =>
      this.dependencyDepth(this.requirePolicy(dependency.nodeId, dependency.serviceId), nextVisiting)
    ))
  }

  private isHealthy(snapshot: ServiceSnapshot, policy: ServiceRecoveryPolicy): boolean {
    return snapshot.lifecycleState === policy.expectedState && snapshot.healthy
  }

  private targetKey(nodeId: string, serviceId: string): string {
    return `${nodeId}/${serviceId}`
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
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
