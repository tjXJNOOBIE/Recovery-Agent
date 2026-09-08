import type { RecoveryWatchSurface } from './RecoveryWatchSurface.js'
import type { RecoveryWatchService } from './RecoveryWatchService.js'
import type { RecoveryCertificateWatchService } from './certificate/RecoveryCertificateWatchService.js'
import type { RecoveryNodeWatchService } from './node/RecoveryNodeWatchService.js'
import type { RecoveryReadinessWatchService } from './readiness/RecoveryReadinessWatchService.js'

export class RecoveryWatchCoordinator implements RecoveryWatchSurface {
  private readonly serviceWatchService: RecoveryWatchService
  private readonly nodeWatchService: RecoveryNodeWatchService
  private readonly readinessWatchService: RecoveryReadinessWatchService | undefined
  private readonly certificateWatchService: RecoveryCertificateWatchService | undefined
  private readonly pulseMs: number
  private timer: NodeJS.Timeout | undefined
  private inFlight: Promise<unknown> | undefined

  public constructor(serviceWatchService: RecoveryWatchService, nodeWatchService: RecoveryNodeWatchService, pulseMs = 1_000, readinessWatchService?: RecoveryReadinessWatchService, certificateWatchService?: RecoveryCertificateWatchService) {
    if (!Number.isInteger(pulseMs) || pulseMs <= 0) throw new Error('Recovery watch coordinator pulse must be a positive integer number of milliseconds')
    this.serviceWatchService = serviceWatchService
    this.nodeWatchService = nodeWatchService
    this.readinessWatchService = readinessWatchService
    this.certificateWatchService = certificateWatchService
    this.pulseMs = pulseMs
  }

  public start(): void {
    if (this.timer !== undefined) throw new Error('Recovery watch coordinator is already running')
    this.runFromTimer()
    this.timer = setInterval(() => this.runFromTimer(), this.pulseMs)
    this.timer.unref()
  }

  public listStates() {
    return {
      services: this.serviceWatchService.listStates(),
      nodes: this.nodeWatchService.listStates(),
      nodeHealthIncidents: this.nodeWatchService.listIncidents(),
      ...(this.certificateWatchService === undefined ? {} : { certificates: this.certificateWatchService.listStates(), certificateIncidents: this.certificateWatchService.listIncidents() }),
      ...(this.readinessWatchService === undefined ? {} : { readiness: this.readinessWatchService.inspectState() }),
    }
  }

  public async runAllNow(nowMs = Date.now()) {
    if (this.inFlight !== undefined) await this.inFlight
    const nodes = await this.nodeWatchService.runAllNow(nowMs)
    const certificates = this.certificateWatchService === undefined ? undefined : await this.certificateWatchService.runNow(nowMs)
    const services = await this.serviceWatchService.runAllNow(nowMs)
    const readiness = this.readinessWatchService === undefined ? undefined : await this.readinessWatchService.runNow(nowMs)
    return { nodes, ...(certificates === undefined ? {} : { certificates }), services, ...(readiness === undefined ? {} : { readiness }) }
  }

  public async close(): Promise<void> {
    const timer = this.timer
    this.timer = undefined
    if (timer !== undefined) clearInterval(timer)
    if (this.inFlight !== undefined) await this.inFlight
    await this.readinessWatchService?.close()
    await this.certificateWatchService?.close()
    await this.nodeWatchService.close()
    await this.serviceWatchService.close()
  }

  private runFromTimer(): void {
    if (this.inFlight !== undefined) return
    const execution = this.runDueWatches()
    this.inFlight = execution
    void execution.then(() => this.clearInFlight(execution), () => this.clearInFlight(execution))
  }

  private async runDueWatches(nowMs = Date.now()): Promise<unknown> {
    const nodes = await this.nodeWatchService.runDueWatches(nowMs)
    const certificates = this.certificateWatchService === undefined ? undefined : await this.certificateWatchService.runDueWatch(nowMs)
    const services = await this.serviceWatchService.runDueWatches(nowMs)
    const readiness = this.readinessWatchService === undefined ? undefined : await this.readinessWatchService.runDueWatch(nowMs)
    return { nodes, ...(certificates === undefined ? {} : { certificates }), services, ...(readiness === undefined ? {} : { readiness }) }
  }

  private clearInFlight(execution: Promise<unknown>): void { if (this.inFlight === execution) this.inFlight = undefined }
}
