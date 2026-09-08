import type { INodeAgentGateway } from '../../node/gateway/INodeAgentGateway.js'
import type { IRecoveryInvestigator } from '../investigation/IRecoveryInvestigator.js'
import type { InMemoryIncidentRepository } from '../incident/repository/InMemoryIncidentRepository.js'
import type { RecoveryPolicyResolver } from '../policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'
import type { RecoveryRunResult } from './RecoveryRunResult.js'

export class RecoveryOrchestrator {
  private readonly policyResolver: RecoveryPolicyResolver
  private readonly incidentRepository: InMemoryIncidentRepository
  private readonly investigator: IRecoveryInvestigator

  public constructor(
    policyResolver: RecoveryPolicyResolver,
    incidentRepository: InMemoryIncidentRepository,
    investigator: IRecoveryInvestigator,
  ) {
    this.policyResolver = policyResolver
    this.incidentRepository = incidentRepository
    this.investigator = investigator
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
      for (let attempt = 1; attempt <= policy.maxRestartAttempts; attempt += 1) {
        restartAttempts = attempt
        incident = this.incidentRepository.append(incident.id, 'action', `Restart attempt ${attempt} requested`, 'recovering')
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

    const investigation = await this.investigator.investigate({
      incident,
      before: initialSnapshot,
      afterAttempts: currentSnapshot,
      attempts: restartAttempts,
    })
    incident = this.incidentRepository.append(incident.id, 'investigation', investigation.summary, 'recovering')
    incident = this.incidentRepository.append(
      incident.id,
      'escalated',
      investigation.requiresHuman ? 'Human intervention required after bounded recovery' : 'Investigation completed without an authorized automatic action',
      'human_required',
    )
    return {
      status: 'escalated',
      snapshot: currentSnapshot,
      incident,
      investigationSummary: investigation.summary,
      restartAttempts,
    }
  }
}
