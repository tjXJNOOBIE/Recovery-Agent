import type { IRecoveryDurabilityStateCheckpoint } from '../durability/RecoveryDurabilityCheckpointBarrier.js'
import type { RecoveryDurableWatchState } from '../durability/RecoveryDurableState.js'
import type { RecoveryDurableWatchStateSurface } from '../durability/RecoveryDurableStateCoordinator.js'
import type { RecoveryWatchSurface } from './RecoveryWatchSurface.js'
import type { RecoveryWatchService } from './RecoveryWatchService.js'
import type { RecoveryCertificateWatchService } from './certificate/RecoveryCertificateWatchService.js'
import type { RecoveryDeploymentWatchService } from './deployment/RecoveryDeploymentWatchService.js'
import type { RecoveryNodeWatchService } from './node/RecoveryNodeWatchService.js'
import type { RecoveryReadinessWatchService } from './readiness/RecoveryReadinessWatchService.js'

export class RecoveryWatchCoordinator implements RecoveryWatchSurface, RecoveryDurableWatchStateSurface {
  private readonly serviceWatchService: RecoveryWatchService
  private readonly nodeWatchService: RecoveryNodeWatchService
  private readonly readinessWatchService: RecoveryReadinessWatchService | undefined
  private readonly certificateWatchService: RecoveryCertificateWatchService | undefined
  private readonly deploymentWatchService: RecoveryDeploymentWatchService | undefined
  private readonly pulseMs: number
  private readonly durabilityStateCheckpoint: IRecoveryDurabilityStateCheckpoint | undefined
  private timer: NodeJS.Timeout | undefined
  private inFlight: Promise<unknown> | undefined

  public constructor(serviceWatchService: RecoveryWatchService, nodeWatchService: RecoveryNodeWatchService, pulseMs = 1_000, readinessWatchService?: RecoveryReadinessWatchService, certificateWatchService?: RecoveryCertificateWatchService, deploymentWatchService?: RecoveryDeploymentWatchService, durabilityStateCheckpoint?: IRecoveryDurabilityStateCheckpoint) {
    if (!Number.isInteger(pulseMs) || pulseMs <= 0) throw new Error('Recovery watch coordinator pulse must be a positive integer number of milliseconds')
    this.serviceWatchService = serviceWatchService; this.nodeWatchService = nodeWatchService; this.readinessWatchService = readinessWatchService; this.certificateWatchService = certificateWatchService; this.deploymentWatchService = deploymentWatchService; this.pulseMs = pulseMs; this.durabilityStateCheckpoint = durabilityStateCheckpoint
  }

  public start(): void { if (this.timer !== undefined) throw new Error('Recovery watch coordinator is already running'); this.runFromTimer(); this.timer = setInterval(() => this.runFromTimer(), this.pulseMs); this.timer.unref() }

  public listStates() {
    return {
      services: this.serviceWatchService.listStates(), nodes: this.nodeWatchService.listStates(), nodeHealthIncidents: this.nodeWatchService.listIncidents(),
      ...(this.certificateWatchService === undefined ? {} : { certificates: this.certificateWatchService.listStates(), certificateIncidents: this.certificateWatchService.listIncidents() }),
      ...(this.deploymentWatchService === undefined ? {} : { deployments: this.deploymentWatchService.listStates(), deploymentIncidents: this.deploymentWatchService.listIncidents() }),
      ...(this.readinessWatchService === undefined ? {} : { readiness: this.readinessWatchService.inspectState() }),
    }
  }

  public exportDurableState(): RecoveryDurableWatchState {
    return {
      nodeHealthIncidents: this.nodeWatchService.listIncidents(),
      certificateIncidents: this.certificateWatchService?.listIncidents() ?? [],
      deploymentStates: this.deploymentWatchService?.listStates() ?? [],
      deploymentIncidents: this.deploymentWatchService?.listIncidents() ?? [],
    }
  }

  public restoreDurableState(state: RecoveryDurableWatchState): void {
    this.nodeWatchService.restoreIncidents(state.nodeHealthIncidents)
    if (this.certificateWatchService === undefined && state.certificateIncidents.length > 0) throw new Error('Durable certificate incidents exist but certificate watch is not configured')
    this.certificateWatchService?.restoreIncidents(state.certificateIncidents)
    if (this.deploymentWatchService === undefined && (state.deploymentStates.length > 0 || state.deploymentIncidents.length > 0)) throw new Error('Durable deployment state exists but deployment watch is not configured')
    this.deploymentWatchService?.restoreDurableState(state.deploymentStates, state.deploymentIncidents)
  }

  public async runAllNow(nowMs = Date.now()) {
    if (this.inFlight !== undefined) await this.inFlight
    return this.runOrderedWatches(nowMs, true)
  }

  public async close(): Promise<void> {
    const timer = this.timer; this.timer = undefined; if (timer !== undefined) clearInterval(timer); if (this.inFlight !== undefined) await this.inFlight
    await this.readinessWatchService?.close(); await this.deploymentWatchService?.close(); await this.certificateWatchService?.close(); await this.nodeWatchService.close(); await this.serviceWatchService.close()
  }

  private runFromTimer(): void { if (this.inFlight !== undefined) return; const execution = this.runOrderedWatches(Date.now(), false); this.inFlight = execution; void execution.then(() => this.clearInFlight(execution), () => this.clearInFlight(execution)) }

  private async runOrderedWatches(nowMs: number, force: boolean): Promise<unknown> {
    const before = this.durableCausalFingerprint()
    const nodes = force ? await this.nodeWatchService.runAllNow(nowMs) : await this.nodeWatchService.runDueWatches(nowMs)
    const certificates = this.certificateWatchService === undefined ? undefined : force ? await this.certificateWatchService.runNow(nowMs) : await this.certificateWatchService.runDueWatch(nowMs)
    const deployments = this.deploymentWatchService === undefined ? undefined : force ? await this.deploymentWatchService.runNow(nowMs) : await this.deploymentWatchService.runDueWatch(nowMs)
    if (before !== this.durableCausalFingerprint()) await this.durabilityStateCheckpoint?.checkpointState()
    const services = force ? await this.serviceWatchService.runAllNow(nowMs) : await this.serviceWatchService.runDueWatches(nowMs)
    const readiness = this.readinessWatchService === undefined ? undefined : force ? await this.readinessWatchService.runNow(nowMs) : await this.readinessWatchService.runDueWatch(nowMs)
    return { nodes, ...(certificates === undefined ? {} : { certificates }), ...(deployments === undefined ? {} : { deployments }), services, ...(readiness === undefined ? {} : { readiness }) }
  }

  private durableCausalFingerprint(): string {
    const state = this.exportDurableState()
    return JSON.stringify({
      nodeHealthIncidents: state.nodeHealthIncidents,
      certificateIncidents: state.certificateIncidents,
      deploymentStates: state.deploymentStates.map(({ lastCheckedAt: _lastCheckedAt, ...causal }) => causal),
      deploymentIncidents: state.deploymentIncidents,
    })
  }

  private clearInFlight(execution: Promise<unknown>): void { if (this.inFlight === execution) this.inFlight = undefined }
}
