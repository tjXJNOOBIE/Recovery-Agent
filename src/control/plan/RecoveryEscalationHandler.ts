import type { ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { IncidentRecord } from '../incident/data/IncidentRecord.js'
import type { InMemoryIncidentRepository } from '../incident/repository/InMemoryIncidentRepository.js'
import type { IRecoveryInvestigator } from '../investigation/IRecoveryInvestigator.js'
import type { IRecoveryPlanner } from './IRecoveryPlanner.js'
import type { InMemoryRecoveryPlanRepository } from './InMemoryRecoveryPlanRepository.js'
import type { RecoveryPlan } from './RecoveryPlan.js'

export interface RecoveryEscalationRequest {
  readonly incident: IncidentRecord
  readonly before: ServiceSnapshot
  readonly afterAttempts: ServiceSnapshot
  readonly attempts: number
}

export interface RecoveryEscalationResult {
  readonly incident: IncidentRecord
  readonly investigationSummary: string
  readonly plan?: RecoveryPlan
}

export class RecoveryEscalationHandler {
  private readonly incidentRepository: InMemoryIncidentRepository
  private readonly investigator: IRecoveryInvestigator
  private readonly planner: IRecoveryPlanner
  private readonly planRepository: InMemoryRecoveryPlanRepository

  public constructor(
    incidentRepository: InMemoryIncidentRepository,
    investigator: IRecoveryInvestigator,
    planner: IRecoveryPlanner,
    planRepository: InMemoryRecoveryPlanRepository,
  ) {
    this.incidentRepository = incidentRepository
    this.investigator = investigator
    this.planner = planner
    this.planRepository = planRepository
  }

  public async investigateAndPlan(request: RecoveryEscalationRequest): Promise<RecoveryEscalationResult> {
    const investigation = await this.investigator.investigate(request)
    let incident = this.incidentRepository.append(
      request.incident.id,
      'investigation',
      investigation.summary,
      'recovering',
    )

    try {
      const proposal = await this.planner.plan({ ...request, incident, investigationSummary: investigation.summary })
      if (proposal.action === 'restart_service') {
        const plan = this.planRepository.create({
          incidentId: incident.id,
          nodeId: incident.nodeId,
          serviceId: incident.serviceId,
          rationale: proposal.rationale,
        })
        incident = this.incidentRepository.append(
          incident.id,
          'plan_proposed',
          `Recovery plan ${plan.id} proposes one additional restart and requires explicit approval`,
          'approval_required',
        )
        return { incident, investigationSummary: investigation.summary, plan }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      incident = this.incidentRepository.append(
        incident.id,
        'plan_proposed',
        `Recovery planning failed safely: ${message}`,
        'recovering',
      )
    }

    incident = this.incidentRepository.append(
      incident.id,
      'escalated',
      investigation.requiresHuman
        ? 'Human intervention required after bounded recovery'
        : 'No authorized automatic recovery plan was produced',
      'human_required',
    )
    return { incident, investigationSummary: investigation.summary }
  }
}
