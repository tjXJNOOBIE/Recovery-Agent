export interface ServiceRecoveryPolicy {
  readonly nodeId: string
  readonly serviceId: string
  readonly expectedState: 'running'
  readonly restartAllowed: boolean
  readonly maxRestartAttempts: number
  readonly restartBudgetWindowMs?: number
}

export type RecoveryDecision = 'healthy' | 'restart' | 'investigate' | 'human'
