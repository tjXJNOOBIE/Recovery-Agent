import type { NodeResourceSnapshot } from '../../../node/data/NodeResourceSnapshot.js'

export interface RecoveryNodeResourceThresholds {
  readonly maxMemoryUsedPercent: number
  readonly maxSwapUsedPercent: number
  readonly maxRootFilesystemUsedPercent: number
  readonly maxLoadAverage1mPerCpu: number
}

export const DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS: RecoveryNodeResourceThresholds = {
  maxMemoryUsedPercent: 92,
  maxSwapUsedPercent: 80,
  maxRootFilesystemUsedPercent: 90,
  maxLoadAverage1mPerCpu: 2,
}

export interface RecoveryNodeWatchDefinition {
  readonly nodeId: string
  readonly intervalMs: number
  readonly thresholds: RecoveryNodeResourceThresholds
}

export type RecoveryNodeResourceMetric =
  | 'memory_used_percent'
  | 'swap_used_percent'
  | 'root_filesystem_used_percent'
  | 'load_average_1m_per_cpu'

export interface RecoveryNodeResourceViolation {
  readonly metric: RecoveryNodeResourceMetric
  readonly value: number
  readonly threshold: number
}

export type RecoveryNodeWatchStatus = 'never_run' | 'healthy' | 'degraded' | 'unreachable' | 'unsupported'

export interface RecoveryNodeWatchState {
  readonly nodeId: string
  readonly intervalMs: number
  readonly lastStatus: RecoveryNodeWatchStatus
  readonly lastStartedAt?: string
  readonly lastCompletedAt?: string
  readonly resources?: NodeResourceSnapshot
  readonly violations: readonly RecoveryNodeResourceViolation[]
  readonly incidentId?: string
  readonly lastError?: string
}
