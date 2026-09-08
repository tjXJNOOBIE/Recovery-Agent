export interface RecoveryServiceDependency {
  readonly nodeId: string
  readonly serviceId: string
}

export interface ServiceRecoveryPolicy {
  readonly nodeId: string
  readonly serviceId: string
  readonly expectedState: 'running'
  readonly restartAllowed: boolean
  readonly maxRestartAttempts: number
  readonly restartBudgetWindowMs?: number
  readonly dependencies?: readonly RecoveryServiceDependency[]
}

export type RecoveryDecision = 'healthy' | 'restart' | 'investigate' | 'human'
