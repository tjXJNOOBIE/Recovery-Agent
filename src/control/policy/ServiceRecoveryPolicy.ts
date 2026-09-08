export interface ServiceRecoveryPolicy {
  readonly nodeId: string
  readonly serviceId: string
  readonly expectedState: 'running'
  readonly restartAllowed: boolean
  readonly maxRestartAttempts: number
}

export type RecoveryDecision = 'healthy' | 'restart' | 'investigate' | 'human'
