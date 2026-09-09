import { randomUUID } from 'node:crypto'

import type { FleetStatusResult } from '../../runtime/RecoveryControlRuntime.js'

export const DEFAULT_DEPLOYMENT_WATCH_INTERVAL_MS = 30_000
export const DEFAULT_DEPLOYMENT_STABILIZATION_INTERVAL_MS = 5_000
export const DEFAULT_DEPLOYMENT_STABILIZATION_WINDOW_MS = 600_000

export type RecoveryDeploymentWatchStatus = 'baseline' | 'stable' | 'stabilizing' | 'regressed' | 'unavailable'

export interface RecoveryDeploymentWatchState {
  readonly nodeId: string
  readonly serviceId: string
  readonly status: RecoveryDeploymentWatchStatus
  readonly marker?: string
  readonly previousMarker?: string
  readonly deploymentDetectedAt?: string
  readonly stabilizationEndsAt?: string
  readonly lastCheckedAt: string
  readonly incidentId?: string
  readonly error?: string
}

export interface DeploymentHealthIncident {
  readonly id: string
  readonly nodeId: string
  readonly serviceId: string
  readonly status: 'open' | 'resolved'
  readonly openedAt: string
  readonly updatedAt: string
  readonly message: string
}

export interface RecoveryDeploymentInspectionRuntime { fleetStatus(): Promise<FleetStatusResult> }

export class RecoveryDeploymentWatchService {
  private readonly runtime: RecoveryDeploymentInspectionRuntime
  private readonly normalIntervalMs: number
  private readonly stabilizationIntervalMs: number
  private readonly stabilizationWindowMs: number
  private states: RecoveryDeploymentWatchState[] = []
  private incidents: DeploymentHealthIncident[] = []
  private lastStartedAtMs: number | undefined
  private inFlight: Promise<readonly RecoveryDeploymentWatchState[]> | undefined

  public constructor(runtime: RecoveryDeploymentInspectionRuntime, normalIntervalMs = DEFAULT_DEPLOYMENT_WATCH_INTERVAL_MS, stabilizationIntervalMs = DEFAULT_DEPLOYMENT_STABILIZATION_INTERVAL_MS, stabilizationWindowMs = DEFAULT_DEPLOYMENT_STABILIZATION_WINDOW_MS) {
    for (const [label, value] of [['normal interval', normalIntervalMs], ['stabilization interval', stabilizationIntervalMs], ['stabilization window', stabilizationWindowMs]] as const) {
      if (!Number.isInteger(value) || value <= 0) throw new Error(`Deployment watch ${label} must be a positive integer`)
    }
    this.runtime = runtime
    this.normalIntervalMs = normalIntervalMs
    this.stabilizationIntervalMs = stabilizationIntervalMs
    this.stabilizationWindowMs = stabilizationWindowMs
  }

  public listStates(): readonly RecoveryDeploymentWatchState[] { return this.states }
  public listIncidents(): readonly DeploymentHealthIncident[] { return this.incidents }

  public runDueWatch(nowMs = Date.now()): Promise<readonly RecoveryDeploymentWatchState[]> {
    if (this.inFlight !== undefined) return this.inFlight
    const interval = this.states.some((state) => state.status === 'stabilizing' || state.status === 'regressed') ? this.stabilizationIntervalMs : this.normalIntervalMs
    if (this.lastStartedAtMs !== undefined && nowMs - this.lastStartedAtMs < interval) return Promise.resolve(this.states)
    return this.begin(nowMs)
  }

  public async runNow(nowMs = Date.now()): Promise<readonly RecoveryDeploymentWatchState[]> {
    if (this.inFlight !== undefined) await this.inFlight
    return this.begin(nowMs)
  }

  public async close(): Promise<void> { if (this.inFlight !== undefined) await this.inFlight }

  private begin(nowMs: number): Promise<readonly RecoveryDeploymentWatchState[]> {
    this.lastStartedAtMs = nowMs
    const execution = this.execute(nowMs)
    this.inFlight = execution
    void execution.then(() => this.clear(execution), () => this.clear(execution))
    return execution
  }

  private clear(execution: Promise<readonly RecoveryDeploymentWatchState[]>): void { if (this.inFlight === execution) this.inFlight = undefined }

  private async execute(nowMs: number): Promise<readonly RecoveryDeploymentWatchState[]> {
    const fleet = await this.runtime.fleetStatus()
    const previousByTarget = new Map(this.states.map((state) => [this.key(state.nodeId, state.serviceId), state]))
    const next: RecoveryDeploymentWatchState[] = []
    for (const service of fleet.nodes.flatMap((node) => node.services)) {
      const evidence = service.deployment
      if (evidence === undefined) continue
      const key = this.key(service.nodeId, service.serviceId)
      const previous = previousByTarget.get(key)
      const checkedAt = new Date(nowMs).toISOString()
      if (!evidence.available || evidence.marker === undefined) {
        next.push({ nodeId: service.nodeId, serviceId: service.serviceId, status: 'unavailable', lastCheckedAt: checkedAt, ...(evidence.error === undefined ? {} : { error: evidence.error }) })
        continue
      }
      if (previous === undefined || previous.marker === undefined) {
        next.push({ nodeId: service.nodeId, serviceId: service.serviceId, status: 'baseline', marker: evidence.marker, lastCheckedAt: checkedAt })
        continue
      }
      if (previous.marker !== evidence.marker) {
        const incident = service.healthy ? undefined : this.openOrUpdate(service.nodeId, service.serviceId, 'Service unhealthy immediately after a newly detected deployment')
        next.push({
          nodeId: service.nodeId,
          serviceId: service.serviceId,
          status: service.healthy ? 'stabilizing' : 'regressed',
          marker: evidence.marker,
          previousMarker: previous.marker,
          deploymentDetectedAt: checkedAt,
          stabilizationEndsAt: new Date(nowMs + this.stabilizationWindowMs).toISOString(),
          lastCheckedAt: checkedAt,
          ...(incident === undefined ? {} : { incidentId: incident.id }),
        })
        continue
      }
      const stabilizationEndsAtMs = previous.stabilizationEndsAt === undefined ? undefined : Date.parse(previous.stabilizationEndsAt)
      const inWindow = stabilizationEndsAtMs !== undefined && Number.isFinite(stabilizationEndsAtMs) && nowMs < stabilizationEndsAtMs
      if (inWindow) {
        const incident = service.healthy
          ? this.findOpen(service.nodeId, service.serviceId)
          : this.openOrUpdate(service.nodeId, service.serviceId, 'Service unhealthy during post-deployment stabilization window')
        next.push({
          ...previous,
          status: service.healthy ? 'stabilizing' : 'regressed',
          marker: evidence.marker,
          lastCheckedAt: checkedAt,
          ...(incident === undefined ? {} : { incidentId: incident.id }),
        })
        continue
      }
      const resolved = this.resolve(service.nodeId, service.serviceId, 'Deployment stabilization window completed with healthy service evidence')
      next.push({ nodeId: service.nodeId, serviceId: service.serviceId, status: 'stable', marker: evidence.marker, lastCheckedAt: checkedAt, ...(resolved === undefined ? {} : { incidentId: resolved.id }) })
    }
    this.states = next
    return this.states
  }

  private key(nodeId: string, serviceId: string): string { return `${nodeId}/${serviceId}` }
  private findOpen(nodeId: string, serviceId: string): DeploymentHealthIncident | undefined { return [...this.incidents].reverse().find((incident) => incident.nodeId === nodeId && incident.serviceId === serviceId && incident.status === 'open') }

  private openOrUpdate(nodeId: string, serviceId: string, message: string): DeploymentHealthIncident {
    const current = this.findOpen(nodeId, serviceId)
    const now = new Date().toISOString()
    if (current === undefined) {
      const incident = { id: randomUUID(), nodeId, serviceId, status: 'open' as const, openedAt: now, updatedAt: now, message }
      this.incidents = [...this.incidents, incident]
      return incident
    }
    if (current.message === message) return current
    const updated = { ...current, updatedAt: now, message }
    this.incidents = this.incidents.map((incident) => incident.id === current.id ? updated : incident)
    return updated
  }

  private resolve(nodeId: string, serviceId: string, message: string): DeploymentHealthIncident | undefined {
    const current = this.findOpen(nodeId, serviceId)
    if (current === undefined) return undefined
    const resolved = { ...current, status: 'resolved' as const, updatedAt: new Date().toISOString(), message }
    this.incidents = this.incidents.map((incident) => incident.id === current.id ? resolved : incident)
    return resolved
  }
}
