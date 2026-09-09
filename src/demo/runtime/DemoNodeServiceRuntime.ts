import type { ServiceActionResult } from '../../node/data/ServiceActionResult.js'
import type { ServiceLifecycleState, ServiceSnapshot } from '../../node/data/ServiceSnapshot.js'
import type { INodeServiceRuntime } from '../../node/runtime/INodeServiceRuntime.js'

export interface DemoServiceDefinition {
  readonly id: string
  readonly lifecycleState: ServiceLifecycleState
  readonly healthy: boolean
  readonly restartRestoresHealth: boolean
}

interface DemoServiceState extends DemoServiceDefinition {
  readonly restartCount: number
}

export class DemoNodeServiceRuntime implements INodeServiceRuntime {
  public readonly nodeId: string
  private states: DemoServiceState[]

  public constructor(nodeId: string, services: readonly DemoServiceDefinition[]) {
    this.nodeId = nodeId
    this.states = services.map((service) => ({ ...service, restartCount: 0 }))
  }

  public async listServices(): Promise<readonly ServiceSnapshot[]> {
    return this.states.map((state) => this.snapshot(state))
  }

  public async inspectService(serviceId: string): Promise<ServiceSnapshot> {
    return this.snapshot(this.requireState(serviceId))
  }

  public async restartService(serviceId: string): Promise<ServiceActionResult> {
    const state = this.requireState(serviceId)
    const next: DemoServiceState = {
      ...state,
      lifecycleState: 'running',
      healthy: state.restartRestoresHealth,
      restartCount: state.restartCount + 1,
    }
    this.states = this.states.map((candidate) => candidate.id === serviceId ? next : candidate)
    return {
      accepted: true,
      action: 'restart',
      message: `Simulated restart accepted for ${serviceId}`,
      snapshot: this.snapshot(next),
    }
  }

  private requireState(serviceId: string): DemoServiceState {
    const state = this.states.find((candidate) => candidate.id === serviceId)
    if (state === undefined) throw new Error(`Unknown demo service: ${serviceId}`)
    return state
  }

  private snapshot(state: DemoServiceState): ServiceSnapshot {
    return {
      nodeId: this.nodeId,
      serviceId: state.id,
      lifecycleState: state.lifecycleState,
      healthy: state.healthy,
      detail: state.healthy ? 'demo health check passing' : 'demo health check failing',
      observedAt: new Date().toISOString(),
      restartCount: state.restartCount,
    }
  }
}
