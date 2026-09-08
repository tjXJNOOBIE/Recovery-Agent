export interface RecoveryWatchDefinition {
  readonly nodeId: string
  readonly serviceId: string
  readonly intervalMs: number
}

export type RecoveryWatchRunStatus = 'never_run' | 'healthy' | 'recovered' | 'escalated' | 'error'

export interface RecoveryWatchState {
  readonly nodeId: string
  readonly serviceId: string
  readonly intervalMs: number
  readonly lastStartedAt?: string
  readonly lastCompletedAt?: string
  readonly lastStatus: RecoveryWatchRunStatus
  readonly lastError?: string
}
