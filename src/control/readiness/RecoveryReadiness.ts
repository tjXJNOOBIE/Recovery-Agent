import type { RecoveryAutomaticRestartBudgetSnapshot } from '../budget/RecoveryAutomaticRestartBudget.js'

export type RecoveryReadinessStatus = 'ready' | 'limited' | 'blocked' | 'unreachable'

export interface RecoveryDependencyReadiness {
  readonly nodeId: string
  readonly serviceId: string
  readonly reachable: boolean
  readonly healthy?: boolean
  readonly detail?: string
  readonly error?: string
}

export interface RecoveryServiceReadiness {
  readonly nodeId: string
  readonly serviceId: string
  readonly observedAt: string
  readonly status: RecoveryReadinessStatus
  readonly targetReachable: boolean
  readonly targetHealthy?: boolean
  readonly restartAllowed: boolean
  readonly automaticRecoveryAvailable: boolean
  readonly humanApprovalRequired: boolean
  readonly automaticBudget: RecoveryAutomaticRestartBudgetSnapshot
  readonly dependencies: readonly RecoveryDependencyReadiness[]
  readonly pendingPlanId?: string
  readonly humanIncidentId?: string
  readonly dependencyBlockedIncidentId?: string
  readonly reasons: readonly string[]
}

export interface RecoveryReadinessReport {
  readonly observedAt: string
  readonly services: readonly RecoveryServiceReadiness[]
  readonly readyServices: number
  readonly limitedServices: number
  readonly blockedServices: number
  readonly unreachableServices: number
}
