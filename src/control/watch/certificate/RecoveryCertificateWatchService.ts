import { randomUUID } from 'node:crypto'

import type { CertificateSnapshot } from '../../../node/certificate/CertificateSnapshot.js'

export const DEFAULT_CERTIFICATE_WATCH_INTERVAL_MS = 21_600_000
export type RecoveryCertificateWatchStatus = 'never_run' | 'healthy' | 'warning' | 'critical' | 'unreachable'

export interface RecoveryCertificateWatchState {
  readonly nodeId: string
  readonly certificateId: string
  readonly status: RecoveryCertificateWatchStatus
  readonly lastCheckedAt?: string
  readonly snapshot?: CertificateSnapshot
  readonly incidentId?: string
}

export interface CertificateHealthIncident {
  readonly id: string
  readonly nodeId: string
  readonly certificateId: string
  readonly status: 'open' | 'resolved'
  readonly openedAt: string
  readonly updatedAt: string
  readonly message: string
}

export interface RecoveryCertificateInspectionRuntime { inspectCertificates(nodeId: string): Promise<readonly CertificateSnapshot[]> }

export class RecoveryCertificateWatchService {
  private readonly runtime: RecoveryCertificateInspectionRuntime
  private readonly nodeIds: readonly string[]
  private readonly intervalMs: number
  private states: RecoveryCertificateWatchState[] = []
  private incidents: CertificateHealthIncident[] = []
  private lastStartedAtMs: number | undefined
  private inFlight: Promise<readonly RecoveryCertificateWatchState[]> | undefined

  public constructor(runtime: RecoveryCertificateInspectionRuntime, nodeIds: readonly string[], intervalMs = DEFAULT_CERTIFICATE_WATCH_INTERVAL_MS) {
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) throw new Error('Certificate watch interval must be a positive integer')
    this.runtime = runtime
    this.nodeIds = [...new Set(nodeIds)]
    this.intervalMs = intervalMs
  }

  public listStates(): readonly RecoveryCertificateWatchState[] { return this.states }
  public listIncidents(): readonly CertificateHealthIncident[] { return this.incidents }

  public runDueWatch(nowMs = Date.now()): Promise<readonly RecoveryCertificateWatchState[]> {
    if (this.inFlight !== undefined) return this.inFlight
    if (this.lastStartedAtMs !== undefined && nowMs - this.lastStartedAtMs < this.intervalMs) return Promise.resolve(this.states)
    return this.begin(nowMs)
  }

  public async runNow(nowMs = Date.now()): Promise<readonly RecoveryCertificateWatchState[]> {
    if (this.inFlight !== undefined) await this.inFlight
    return this.begin(nowMs)
  }

  public async close(): Promise<void> { if (this.inFlight !== undefined) await this.inFlight }

  private begin(nowMs: number): Promise<readonly RecoveryCertificateWatchState[]> {
    this.lastStartedAtMs = nowMs
    const execution = this.execute(nowMs)
    this.inFlight = execution
    void execution.then(() => this.clear(execution), () => this.clear(execution))
    return execution
  }

  private clear(execution: Promise<readonly RecoveryCertificateWatchState[]>): void {
    if (this.inFlight === execution) this.inFlight = undefined
  }

  private async execute(nowMs: number): Promise<readonly RecoveryCertificateWatchState[]> {
    const next: RecoveryCertificateWatchState[] = []
    for (const nodeId of this.nodeIds) {
      try {
        const snapshots = await this.runtime.inspectCertificates(nodeId)
        this.resolve(nodeId, '__node_tls__', 'Certificate inspection endpoint reachable again')
        for (const snapshot of snapshots) next.push(this.evaluate(snapshot, nowMs))
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        const incident = this.openOrUpdate(nodeId, '__node_tls__', `Certificate inspection failed: ${message}`)
        next.push({ nodeId, certificateId: '__node_tls__', status: 'unreachable', lastCheckedAt: new Date(nowMs).toISOString(), incidentId: incident.id })
      }
    }
    this.states = next
    return this.states
  }

  private evaluate(snapshot: CertificateSnapshot, nowMs: number): RecoveryCertificateWatchState {
    let status: RecoveryCertificateWatchStatus = 'healthy'
    let message = 'TLS certificate healthy'
    if (!snapshot.reachable) { status = 'unreachable'; message = snapshot.error ?? 'TLS certificate target unreachable' }
    else if (!snapshot.authorized) { status = 'critical'; message = `TLS certificate authorization failed: ${snapshot.authorizationError ?? 'unknown authorization error'}` }
    else if (snapshot.daysRemaining === undefined) { status = 'critical'; message = 'TLS certificate expiry could not be determined' }
    else if (snapshot.daysRemaining <= snapshot.criticalBeforeDays) { status = 'critical'; message = `TLS certificate expires in ${snapshot.daysRemaining} day(s)` }
    else if (snapshot.daysRemaining <= snapshot.warnBeforeDays) { status = 'warning'; message = `TLS certificate expires in ${snapshot.daysRemaining} day(s)` }

    const incident = status === 'healthy'
      ? this.resolve(snapshot.nodeId, snapshot.certificateId, 'TLS certificate returned to healthy state')
      : this.openOrUpdate(snapshot.nodeId, snapshot.certificateId, message)
    return { nodeId: snapshot.nodeId, certificateId: snapshot.certificateId, status, lastCheckedAt: new Date(nowMs).toISOString(), snapshot, ...(incident === undefined ? {} : { incidentId: incident.id }) }
  }

  private openOrUpdate(nodeId: string, certificateId: string, message: string): CertificateHealthIncident {
    const now = new Date().toISOString()
    const current = [...this.incidents].reverse().find((incident) => incident.nodeId === nodeId && incident.certificateId === certificateId && incident.status === 'open')
    if (current === undefined) {
      const incident = { id: randomUUID(), nodeId, certificateId, status: 'open' as const, openedAt: now, updatedAt: now, message }
      this.incidents = [...this.incidents, incident]
      return incident
    }
    if (current.message === message) return current
    const updated = { ...current, updatedAt: now, message }
    this.incidents = this.incidents.map((incident) => incident.id === current.id ? updated : incident)
    return updated
  }

  private resolve(nodeId: string, certificateId: string, message: string): CertificateHealthIncident | undefined {
    const current = [...this.incidents].reverse().find((incident) => incident.nodeId === nodeId && incident.certificateId === certificateId && incident.status === 'open')
    if (current === undefined) return undefined
    const resolved = { ...current, status: 'resolved' as const, updatedAt: new Date().toISOString(), message }
    this.incidents = this.incidents.map((incident) => incident.id === current.id ? resolved : incident)
    return resolved
  }
}
