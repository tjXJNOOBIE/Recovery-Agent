import type { NodeResourceSnapshot } from '../../../node/data/NodeResourceSnapshot.js'

export interface RecoveryNodeResourceThresholds {
  readonly maxMemoryUsedPercent: number
  readonly maxSwapUsedPercent: number
  readonly maxRootFilesystemUsedPercent: number
  readonly maxRootFilesystemInodeUsedPercent: number
  readonly maxLoadAverage1mPerCpu: number
}

export const DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS: RecoveryNodeResourceThresholds = {
  maxMemoryUsedPercent: 92,
  maxSwapUsedPercent: 80,
  maxRootFilesystemUsedPercent: 90,
  maxRootFilesystemInodeUsedPercent: 90,
  maxLoadAverage1mPerCpu: 2,
}

export const DEFAULT_RECOVERY_NODE_MAX_CLOCK_DRIFT_MS = 30_000

export interface RecoveryNodeWatchDefinition {
  readonly nodeId: string
  readonly intervalMs: number
  readonly thresholds: RecoveryNodeResourceThresholds
  readonly maxClockDriftMs?: number
}

export type RecoveryNodeNumericResourceMetric =
  | 'memory_used_percent'
  | 'swap_used_percent'
  | 'root_filesystem_used_percent'
  | 'root_filesystem_inode_used_percent'
  | 'load_average_1m_per_cpu'
  | 'node_clock_drift_ms'

export type RecoveryNodeResourceMetric = RecoveryNodeNumericResourceMetric | 'root_filesystem_read_only'

export interface RecoveryNodeNumericResourceViolation {
  readonly metric: RecoveryNodeNumericResourceMetric
  readonly value: number
  readonly threshold: number
}

export interface RecoveryNodeReadOnlyFilesystemViolation {
  readonly metric: 'root_filesystem_read_only'
  readonly value: true
  readonly expected: false
}

export type RecoveryNodeResourceViolation = RecoveryNodeNumericResourceViolation | RecoveryNodeReadOnlyFilesystemViolation

export type RecoveryNodeWatchStatus = 'never_run' | 'healthy' | 'degraded' | 'unreachable' | 'unsupported'

export interface RecoveryNodeWatchState {
  readonly nodeId: string
  readonly intervalMs: number
  readonly lastStatus: RecoveryNodeWatchStatus
  readonly lastStartedAt?: string
  readonly lastCompletedAt?: string
  readonly resources?: NodeResourceSnapshot
  readonly clockDriftMs?: number
  readonly requestRoundTripMs?: number
  readonly violations: readonly RecoveryNodeResourceViolation[]
  readonly incidentId?: string
  readonly lastError?: string
}
