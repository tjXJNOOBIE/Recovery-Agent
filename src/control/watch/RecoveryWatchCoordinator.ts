import type { RecoveryWatchSurface } from './RecoveryWatchSurface.js'
import type { RecoveryWatchService } from './RecoveryWatchService.js'
import type { RecoveryNodeWatchService } from './node/RecoveryNodeWatchService.js'

export class RecoveryWatchCoordinator implements RecoveryWatchSurface {
  private readonly serviceWatchService: RecoveryWatchService
  private readonly nodeWatchService: RecoveryNodeWatchService
  private readonly pulseMs: number
  private timer: NodeJS.Timeout | undefined
  private inFlight: Promise<unknown> | undefined

  public constructor(
    serviceWatchService: RecoveryWatchService,
    nodeWatchService: RecoveryNodeWatchService,
    pulseMs = 1_000,
  ) {
    if (!Number.isInteger(pulseMs) || pulseMs <= 0) throw new Error('Recovery watch coordinator pulse must be a positive integer number of milliseconds')
    this.serviceWatchService = serviceWatchService
    this.nodeWatchService = nodeWatchService
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
    }
  }

  public async runAllNow(nowMs = Date.now()) {
    if (this.inFlight !== undefined) await this.inFlight
    const nodes = await this.nodeWatchService.runAllNow(nowMs)
    const services = await this.serviceWatchService.runAllNow(nowMs)
    return { nodes, services }
  }

  public async close(): Promise<void> {
    const timer = this.timer
    this.timer = undefined
    if (timer !== undefined) clearInterval(timer)
    if (this.inFlight !== undefined) await this.inFlight
    await this.nodeWatchService.close()
    await this.serviceWatchService.close()
  }

  private runFromTimer(): void {
    if (this.inFlight !== undefined) return
    const execution = this.runDueWatches()
    this.inFlight = execution
    void execution.then(
      () => this.clearInFlight(execution),
      () => this.clearInFlight(execution),
    )
  }

  private async runDueWatches(nowMs = Date.now()): Promise<unknown> {
    const nodes = await this.nodeWatchService.runDueWatches(nowMs)
    const services = await this.serviceWatchService.runDueWatches(nowMs)
    return { nodes, services }
  }

  private clearInFlight(execution: Promise<unknown>): void {
    if (this.inFlight === execution) this.inFlight = undefined
  }
}
