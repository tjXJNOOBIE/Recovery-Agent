import type { RecoveryPlan, RecoveryPlanStatus } from '../plan/RecoveryPlan.js'
import type { RecoveryDurableSnapshot } from './RecoveryDurableState.js'

export interface RecoveryDurableRetentionPolicy {
  readonly terminalHistoryDays: number
  readonly terminalHistoryPerTarget: number
}

export interface RecoveryDurableControlRetention {
  readonly incidentIds: readonly string[]
  readonly planIds: readonly string[]
}

export interface RecoveryDurableWatchRetention {
  readonly nodeHealthIncidentIds: readonly string[]
  readonly certificateIncidentIds: readonly string[]
  readonly deploymentIncidentIds: readonly string[]
}

export interface RecoveryDurableRetentionRemoval {
  readonly control: RecoveryDurableControlRetention
  readonly watches: RecoveryDurableWatchRetention
}

export interface RecoveryDurableRetentionResult {
  readonly snapshot: RecoveryDurableSnapshot
  readonly removal: RecoveryDurableRetentionRemoval
}

interface TerminalHistoryEntry {
  readonly id: string
  readonly target: string
  readonly terminalAtMs: number
}

const TERMINAL_PLAN_STATUSES: ReadonlySet<RecoveryPlanStatus> = new Set([
  'executed',
  'rejected',
  'failed',
  'superseded',
])

const DAY_MS = 86_400_000

export class RecoveryDurableRetentionService {
  private readonly maximumAgeMs: number
  private readonly maximumPerTarget: number

  public constructor(policy: RecoveryDurableRetentionPolicy) {
    if (!Number.isSafeInteger(policy.terminalHistoryDays) || policy.terminalHistoryDays <= 0) {
      throw new Error('Recovery durable retention terminalHistoryDays must be a positive safe integer')
    }
    if (!Number.isSafeInteger(policy.terminalHistoryPerTarget) || policy.terminalHistoryPerTarget <= 0) {
      throw new Error('Recovery durable retention terminalHistoryPerTarget must be a positive safe integer')
    }
    const maximumAgeMs = policy.terminalHistoryDays * DAY_MS
    if (!Number.isSafeInteger(maximumAgeMs)) {
      throw new Error('Recovery durable retention terminalHistoryDays is too large')
    }
    this.maximumAgeMs = maximumAgeMs
    this.maximumPerTarget = policy.terminalHistoryPerTarget
  }

  public apply(snapshot: RecoveryDurableSnapshot, nowMs = Date.now()): RecoveryDurableRetentionResult {
    if (!Number.isFinite(nowMs)) throw new Error('Recovery durable retention clock must be finite')

    const plansByIncident = new Map<string, RecoveryPlan[]>()
    for (const plan of snapshot.plans) {
      const plans = plansByIncident.get(plan.incidentId) ?? []
      plans.push(plan)
      plansByIncident.set(plan.incidentId, plans)
    }

    const serviceCandidates: TerminalHistoryEntry[] = []
    for (const incident of snapshot.incidents) {
      if (incident.status !== 'resolved') continue
      const plans = plansByIncident.get(incident.id) ?? []
      if (plans.some((plan) => !TERMINAL_PLAN_STATUSES.has(plan.status))) continue
      const lastEvent = incident.timeline.at(-1)
      if (lastEvent === undefined) continue
      const incidentTerminalAtMs = this.timestamp(lastEvent.at, `Recovery incident ${incident.id}`)
      const planTerminalAtMs = plans.reduce(
        (latest, plan) => Math.max(latest, this.timestamp(plan.updatedAt, `Recovery plan ${plan.id}`)),
        incidentTerminalAtMs,
      )
      serviceCandidates.push({
        id: incident.id,
        target: this.targetKey(incident.nodeId, incident.serviceId),
        terminalAtMs: planTerminalAtMs,
      })
    }

    const serviceIncidentIds = this.selectPrunable(serviceCandidates, nowMs)
    const planIds = new Set(
      snapshot.plans
        .filter((plan) => serviceIncidentIds.has(plan.incidentId))
        .map((plan) => plan.id),
    )

    const nodeHealthIncidentIds = this.selectPrunable(
      snapshot.nodeHealthIncidents
        .filter((incident) => incident.status === 'resolved')
        .map((incident) => ({
          id: incident.id,
          target: incident.nodeId,
          terminalAtMs: this.timestamp(incident.updatedAt, `Node-health incident ${incident.id}`),
        })),
      nowMs,
    )

    const certificateIncidentIds = this.selectPrunable(
      snapshot.certificateIncidents
        .filter((incident) => incident.status === 'resolved')
        .map((incident) => ({
          id: incident.id,
          target: this.targetKey(incident.nodeId, incident.certificateId),
          terminalAtMs: this.timestamp(incident.updatedAt, `Certificate incident ${incident.id}`),
        })),
      nowMs,
    )

    const deploymentIncidentIds = this.selectPrunable(
      snapshot.deploymentIncidents
        .filter((incident) => incident.status === 'resolved')
        .map((incident) => ({
          id: incident.id,
          target: this.targetKey(incident.nodeId, incident.serviceId),
          terminalAtMs: this.timestamp(incident.updatedAt, `Deployment incident ${incident.id}`),
        })),
      nowMs,
    )

    const retainedDeploymentStates = snapshot.deploymentStates.map((state) => {
      if (state.incidentId === undefined || !deploymentIncidentIds.has(state.incidentId)) return state
      const { incidentId: _incidentId, ...withoutIncident } = state
      return withoutIncident
    })

    return {
      snapshot: {
        ...snapshot,
        incidents: snapshot.incidents.filter((incident) => !serviceIncidentIds.has(incident.id)),
        plans: snapshot.plans.filter((plan) => !planIds.has(plan.id)),
        nodeHealthIncidents: snapshot.nodeHealthIncidents.filter((incident) => !nodeHealthIncidentIds.has(incident.id)),
        certificateIncidents: snapshot.certificateIncidents.filter((incident) => !certificateIncidentIds.has(incident.id)),
        deploymentStates: retainedDeploymentStates,
        deploymentIncidents: snapshot.deploymentIncidents.filter((incident) => !deploymentIncidentIds.has(incident.id)),
        audit: snapshot.audit,
      },
      removal: {
        control: {
          incidentIds: [...serviceIncidentIds],
          planIds: [...planIds],
        },
        watches: {
          nodeHealthIncidentIds: [...nodeHealthIncidentIds],
          certificateIncidentIds: [...certificateIncidentIds],
          deploymentIncidentIds: [...deploymentIncidentIds],
        },
      },
    }
  }

  public static removalCount(removal: RecoveryDurableRetentionRemoval): number {
    return removal.control.incidentIds.length
      + removal.control.planIds.length
      + removal.watches.nodeHealthIncidentIds.length
      + removal.watches.certificateIncidentIds.length
      + removal.watches.deploymentIncidentIds.length
  }

  private selectPrunable(entries: readonly TerminalHistoryEntry[], nowMs: number): Set<string> {
    const byTarget = new Map<string, TerminalHistoryEntry[]>()
    for (const entry of entries) {
      const targetEntries = byTarget.get(entry.target) ?? []
      targetEntries.push(entry)
      byTarget.set(entry.target, targetEntries)
    }

    const prunable = new Set<string>()
    for (const targetEntries of byTarget.values()) {
      targetEntries.sort((left, right) => right.terminalAtMs - left.terminalAtMs)
      targetEntries.forEach((entry, index) => {
        const tooOld = nowMs - entry.terminalAtMs > this.maximumAgeMs
        const overTargetLimit = index >= this.maximumPerTarget
        if (tooOld || overTargetLimit) prunable.add(entry.id)
      })
    }
    return prunable
  }

  private timestamp(value: string, label: string): number {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) throw new Error(`${label} terminal timestamp must be valid`)
    return parsed
  }

  private targetKey(left: string, right: string): string {
    return `${left}/${right}`
  }
}
