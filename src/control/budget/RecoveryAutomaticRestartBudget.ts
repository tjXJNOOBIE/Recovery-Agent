import type { ServiceRecoveryPolicy } from '../policy/ServiceRecoveryPolicy.js'

export const DEFAULT_AUTOMATIC_RESTART_BUDGET_WINDOW_MS = 600_000

export interface RecoveryAutomaticRestartBudgetSnapshot {
  readonly nodeId: string
  readonly serviceId: string
  readonly windowMs: number
  readonly maximumAttempts: number
  readonly usedAttempts: number
  readonly remainingAttempts: number
}

export interface RecoveryAutomaticRestartBudgetDecision {
  readonly allowed: boolean
  readonly snapshot: RecoveryAutomaticRestartBudgetSnapshot
}

interface RecoveryAutomaticRestartAttempt {
  readonly nodeId: string
  readonly serviceId: string
  readonly atMs: number
}

export type RecoveryClock = () => number

export class RecoveryAutomaticRestartBudget {
  private readonly clock: RecoveryClock
  private attempts: readonly RecoveryAutomaticRestartAttempt[] = []

  public constructor(clock: RecoveryClock = Date.now) {
    this.clock = clock
  }

  public inspect(policy: ServiceRecoveryPolicy): RecoveryAutomaticRestartBudgetSnapshot {
    return this.snapshot(policy, this.now())
  }

  public tryConsume(policy: ServiceRecoveryPolicy): RecoveryAutomaticRestartBudgetDecision {
    const nowMs = this.now()
    const before = this.snapshot(policy, nowMs)
    if (before.remainingAttempts === 0) {
      return { allowed: false, snapshot: before }
    }

    this.attempts = [...this.attempts, {
      nodeId: policy.nodeId,
      serviceId: policy.serviceId,
      atMs: nowMs,
    }]

    return {
      allowed: true,
      snapshot: {
        ...before,
        usedAttempts: before.usedAttempts + 1,
        remainingAttempts: before.remainingAttempts - 1,
      },
    }
  }

  private snapshot(policy: ServiceRecoveryPolicy, nowMs: number): RecoveryAutomaticRestartBudgetSnapshot {
    this.validateMaximumAttempts(policy.maxRestartAttempts)
    const windowMs = this.resolveWindowMs(policy)
    const cutoff = nowMs - windowMs

    this.attempts = this.attempts.filter((attempt) =>
      attempt.nodeId !== policy.nodeId
      || attempt.serviceId !== policy.serviceId
      || attempt.atMs > cutoff
    )

    const usedAttempts = this.attempts.filter((attempt) =>
      attempt.nodeId === policy.nodeId && attempt.serviceId === policy.serviceId
    ).length

    return {
      nodeId: policy.nodeId,
      serviceId: policy.serviceId,
      windowMs,
      maximumAttempts: policy.maxRestartAttempts,
      usedAttempts,
      remainingAttempts: Math.max(0, policy.maxRestartAttempts - usedAttempts),
    }
  }

  private resolveWindowMs(policy: ServiceRecoveryPolicy): number {
    const windowMs = policy.restartBudgetWindowMs ?? DEFAULT_AUTOMATIC_RESTART_BUDGET_WINDOW_MS
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
      throw new Error('Automatic restart budget window must be a positive integer number of milliseconds')
    }
    return windowMs
  }

  private validateMaximumAttempts(maximumAttempts: number): void {
    if (!Number.isInteger(maximumAttempts) || maximumAttempts < 0) {
      throw new Error('Automatic restart budget maximum attempts must be a non-negative integer')
    }
  }

  private now(): number {
    const nowMs = this.clock()
    if (!Number.isFinite(nowMs)) {
      throw new Error('Recovery clock must return a finite timestamp')
    }
    return nowMs
  }
}
