import type { RecoveryControlRuntime } from '../runtime/RecoveryControlRuntime.js'
import type { RecoveryRunResult } from '../recovery/RecoveryRunResult.js'
import type { RecoveryWatchDefinition, RecoveryWatchState } from './RecoveryWatchDefinition.js'

interface RecoveryWatchRuntimeState {
  readonly definition: RecoveryWatchDefinition
  readonly lastStartedAtMs?: number
  readonly publicState: RecoveryWatchState
}

export interface RecoveryWatchExecutionResult {
  readonly nodeId: string
  readonly serviceId: string
  readonly recovery?: RecoveryRunResult
  readonly error?: string
}

export class RecoveryWatchService {
  private readonly controlRuntime: RecoveryControlRuntime
  private readonly pulseMs: number
  private states: readonly RecoveryWatchRuntimeState[]
  private timer: NodeJS.Timeout | undefined
  private inFlight: Promise<readonly RecoveryWatchExecutionResult[]> | undefined

  public constructor(
    controlRuntime: RecoveryControlRuntime,
    definitions: readonly RecoveryWatchDefinition[],
    pulseMs = 1_000,
  ) {
    if (!Number.isInteger(pulseMs) || pulseMs <= 0) {
      throw new Error('Recovery watch pulse must be a positive integer number of milliseconds')
    }
    this.controlRuntime = controlRuntime
    this.pulseMs = pulseMs
    this.states = definitions.map((definition) => ({
      definition,
      publicState: {
        nodeId: definition.nodeId,
        serviceId: definition.serviceId,
        intervalMs: definition.intervalMs,
        lastStatus: 'never_run',
      },
    }))
  }

  public start(): void {
    if (this.timer !== undefined) {
      throw new Error('Recovery watch service is already running')
    }

    this.runFromTimer()
    this.timer = setInterval(() => this.runFromTimer(), this.pulseMs)
    this.timer.unref()
  }

  public listStates(): readonly RecoveryWatchState[] {
    return this.states.map((state) => state.publicState)
  }

  public runDueWatches(nowMs = Date.now()): Promise<readonly RecoveryWatchExecutionResult[]> {
    if (this.inFlight !== undefined) {
      return this.inFlight
    }

    const dueDefinitions = this.states
      .filter((state) => state.lastStartedAtMs === undefined || nowMs - state.lastStartedAtMs >= state.definition.intervalMs)
      .map((state) => state.definition)

    return this.beginExecution(dueDefinitions, nowMs)
  }

  public async runAllNow(nowMs = Date.now()): Promise<readonly RecoveryWatchExecutionResult[]> {
    if (this.inFlight !== undefined) {
      await this.inFlight
    }
    return this.beginExecution(this.states.map((state) => state.definition), nowMs)
  }

  public async close(): Promise<void> {
    const timer = this.timer
    this.timer = undefined
    if (timer !== undefined) {
      clearInterval(timer)
    }
    if (this.inFlight !== undefined) {
      await this.inFlight
    }
  }

  private runFromTimer(): void {
    void this.runDueWatches()
  }

  private beginExecution(
    definitions: readonly RecoveryWatchDefinition[],
    startedAtMs: number,
  ): Promise<readonly RecoveryWatchExecutionResult[]> {
    const execution = this.executeDefinitions(definitions, startedAtMs)
    this.inFlight = execution
    void execution.then(
      () => this.clearInFlight(execution),
      () => this.clearInFlight(execution),
    )
    return execution
  }

  private clearInFlight(execution: Promise<readonly RecoveryWatchExecutionResult[]>): void {
    if (this.inFlight === execution) {
      this.inFlight = undefined
    }
  }

  private async executeDefinitions(
    definitions: readonly RecoveryWatchDefinition[],
    startedAtMs: number,
  ): Promise<readonly RecoveryWatchExecutionResult[]> {
    const results: RecoveryWatchExecutionResult[] = []

    for (const definition of definitions) {
      this.markStarted(definition, startedAtMs)
      try {
        const recovery = await this.controlRuntime.recoverService(definition.nodeId, definition.serviceId)
        this.markCompleted(definition, startedAtMs, recovery.status)
        results.push({ nodeId: definition.nodeId, serviceId: definition.serviceId, recovery })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        this.markFailed(definition, startedAtMs, message)
        results.push({ nodeId: definition.nodeId, serviceId: definition.serviceId, error: message })
      }
    }

    return results
  }

  private markStarted(definition: RecoveryWatchDefinition, startedAtMs: number): void {
    this.states = this.states.map((state) => {
      if (!this.matches(state.definition, definition)) return state
      return {
        definition: state.definition,
        lastStartedAtMs: startedAtMs,
        publicState: {
          ...state.publicState,
          lastStartedAt: new Date(startedAtMs).toISOString(),
        },
      }
    })
  }

  private markCompleted(
    definition: RecoveryWatchDefinition,
    completedAtMs: number,
    status: RecoveryRunResult['status'],
  ): void {
    this.states = this.states.map((state) => {
      if (!this.matches(state.definition, definition)) return state
      const { lastError: _lastError, ...publicStateWithoutError } = state.publicState
      return {
        ...state,
        publicState: {
          ...publicStateWithoutError,
          lastCompletedAt: new Date(completedAtMs).toISOString(),
          lastStatus: status,
        },
      }
    })
  }

  private markFailed(definition: RecoveryWatchDefinition, completedAtMs: number, error: string): void {
    this.states = this.states.map((state) => {
      if (!this.matches(state.definition, definition)) return state
      return {
        ...state,
        publicState: {
          ...state.publicState,
          lastCompletedAt: new Date(completedAtMs).toISOString(),
          lastStatus: 'error',
          lastError: error,
        },
      }
    })
  }

  private matches(left: RecoveryWatchDefinition, right: RecoveryWatchDefinition): boolean {
    return left.nodeId === right.nodeId && left.serviceId === right.serviceId
  }
}
