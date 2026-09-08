import type { DeploymentEvidence } from '../deployment/DeploymentEvidence.js'
import type { ServiceHealthCheckResult } from '../health/ServiceHealthCheck.js'
import type { NodeResourceSnapshot } from './NodeResourceSnapshot.js'

export type ServiceLifecycleState = 'running' | 'stopped' | 'failed' | 'unknown'

export interface ServiceSnapshot {
  readonly nodeId: string
  readonly serviceId: string
  readonly lifecycleState: ServiceLifecycleState
  readonly healthy: boolean
  readonly detail: string
  readonly observedAt: string
  readonly restartCount: number
  readonly healthChecks?: readonly ServiceHealthCheckResult[]
  readonly deployment?: DeploymentEvidence
}

export interface NodeSnapshot {
  readonly nodeId: string
  readonly observedAt: string
  readonly services: readonly ServiceSnapshot[]
  readonly resources?: NodeResourceSnapshot
}
