import type { RecoveryReadinessReport } from '../../readiness/RecoveryReadiness.js'

export const DEFAULT_RECOVERY_READINESS_WATCH_INTERVAL_MS = 300_000

export type RecoveryReadinessWatchStatus = 'never_run' | 'completed' | 'error'

export interface RecoveryReadinessWatchState {
  readonly intervalMs: number
  readonly lastStatus: RecoveryReadinessWatchStatus
  readonly lastStartedAt?: string
  readonly lastCompletedAt?: string
  readonly report?: RecoveryReadinessReport
  readonly lastError?: string
}

export interface RecoveryReadinessInspectionRuntime {
  inspectRecoveryReadiness(): Promise<RecoveryReadinessReport>
}

export class RecoveryReadinessWatchService {
  private readonly controlRuntime: RecoveryReadinessInspectionRuntime
  private readonly intervalMs: number
  private lastStartedAtMs: number | undefined
  private inFlight: Promise<RecoveryReadinessWatchState> | undefined
  private state: RecoveryReadinessWatchState

  public constructor(
    controlRuntime: RecoveryReadinessInspectionRuntime,
    intervalMs = DEFAULT_RECOVERY_READINESS_WATCH_INTERVAL_MS,
  ) {
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new Error('Recovery readiness watch interval must be a positive integer number of milliseconds')
    }
    this.controlRuntime = controlRuntime
    this.intervalMs = intervalMs
    this.state = { intervalMs, lastStatus: 'never_run' }
  }

  public inspectState(): RecoveryReadinessWatchState {
    return this.state
  }

  public runDueWatch(nowMs = Date.now()): Promise<RecoveryReadinessWatchState> {
    if (this.inFlight !== undefined) return this.inFlight
    if (this.lastStartedAtMs !== undefined && nowMs - this.lastStartedAtMs < this.intervalMs) {
      return Promise.resolve(this.state)
    }
    return this.beginExecution(nowMs)
  }

  public async runNow(nowMs = Date.now()): Promise<RecoveryReadinessWatchState> {
    if (this.inFlight !== undefined) await this.inFlight
    return this.beginExecution(nowMs)
  }

  public async close(): Promise<void> {
    if (this.inFlight !== undefined) await this.inFlight
  }

  private beginExecution(startedAtMs: number): Promise<RecoveryReadinessWatchState> {
    this.lastStartedAtMs = startedAtMs
    this.state = { ...this.state, lastStartedAt: new Date(startedAtMs).toISOString() }
    const execution = this.execute(startedAtMs)
    this.inFlight = execution
    void execution.then(
      () => this.clearInFlight(execution),
      () => this.clearInFlight(execution),
    )
    return execution
  }

  private async execute(completedAtMs: number): Promise<RecoveryReadinessWatchState> {
    try {
      const report = await this.controlRuntime.inspectRecoveryReadiness()
      const { lastError: _lastError, ...withoutError } = this.state
      this.state = {
        ...withoutError,
        lastStatus: 'completed',
        lastCompletedAt: new Date(completedAtMs).toISOString(),
        report,
      }
    } catch (error: unknown) {
      this.state = {
        ...this.state,
        lastStatus: 'error',
        lastCompletedAt: new Date(completedAtMs).toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      }
    }
    return this.state
  }

  private clearInFlight(execution: Promise<RecoveryReadinessWatchState>): void {
    if (this.inFlight === execution) this.inFlight = undefined
  }
}
