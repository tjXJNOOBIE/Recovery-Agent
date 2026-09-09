import type { RecoveryRunResult } from '../recovery/RecoveryRunResult.js'
import type { RecoveryWatchDefinition, RecoveryWatchState } from './RecoveryWatchDefinition.js'

export interface RecoveryServiceWatchRuntime {
  recoverService(nodeId: string, serviceId: string): Promise<RecoveryRunResult>
}

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
  private readonly controlRuntime: RecoveryServiceWatchRuntime
  private readonly pulseMs: number
  private readonly baseDefinitions: readonly RecoveryWatchDefinition[]
  private states: readonly RecoveryWatchRuntimeState[]
  private timer: NodeJS.Timeout | undefined
  private inFlight: Promise<readonly RecoveryWatchExecutionResult[]> | undefined

  public constructor(controlRuntime: RecoveryServiceWatchRuntime, definitions: readonly RecoveryWatchDefinition[], pulseMs = 1_000) {
    if (!Number.isInteger(pulseMs) || pulseMs <= 0) throw new Error('Recovery watch pulse must be a positive integer number of milliseconds')
    this.controlRuntime = controlRuntime
    this.pulseMs = pulseMs
    this.baseDefinitions = definitions.map((definition) => this.validateDefinition(definition))
    this.states = this.baseDefinitions.map((definition) => this.newState(definition))
  }

  public start(): void {
    if (this.timer !== undefined) throw new Error('Recovery watch service is already running')
    this.runFromTimer()
    this.timer = setInterval(() => this.runFromTimer(), this.pulseMs)
    this.timer.unref()
  }

  public listStates(): readonly RecoveryWatchState[] { return this.states.map((state) => state.publicState) }

  public upsertOverride(definition: RecoveryWatchDefinition): void {
    const normalized = this.validateDefinition(definition)
    const existing = this.states.find((state) => this.matches(state.definition, normalized))
    if (existing === undefined) {
      this.states = [...this.states, this.newState(normalized)]
      return
    }
    this.states = this.states.map((state) => this.matches(state.definition, normalized)
      ? {
          ...state,
          definition: normalized,
          publicState: { ...state.publicState, intervalMs: normalized.intervalMs },
        }
      : state)
  }

  public clearOverride(nodeId: string, serviceId: string): void {
    const base = this.baseDefinitions.find((definition) => definition.nodeId === nodeId && definition.serviceId === serviceId)
    if (base === undefined) {
      this.states = this.states.filter((state) => state.definition.nodeId !== nodeId || state.definition.serviceId !== serviceId)
      return
    }
    this.states = this.states.map((state) => this.matches(state.definition, base)
      ? { ...state, definition: base, publicState: { ...state.publicState, intervalMs: base.intervalMs } }
      : state)
    if (!this.states.some((state) => this.matches(state.definition, base))) this.states = [...this.states, this.newState(base)]
  }

  public runDueWatches(nowMs = Date.now()): Promise<readonly RecoveryWatchExecutionResult[]> {
    if (this.inFlight !== undefined) return this.inFlight
    const dueDefinitions = this.states
      .filter((state) => state.lastStartedAtMs === undefined || nowMs - state.lastStartedAtMs >= state.definition.intervalMs)
      .map((state) => state.definition)
    return this.beginExecution(dueDefinitions, nowMs)
  }

  public async runAllNow(nowMs = Date.now()): Promise<readonly RecoveryWatchExecutionResult[]> {
    if (this.inFlight !== undefined) await this.inFlight
    return this.beginExecution(this.states.map((state) => state.definition), nowMs)
  }

  public async close(): Promise<void> {
    const timer = this.timer
    this.timer = undefined
    if (timer !== undefined) clearInterval(timer)
    if (this.inFlight !== undefined) await this.inFlight
  }

  private runFromTimer(): void { void this.runDueWatches() }

  private beginExecution(definitions: readonly RecoveryWatchDefinition[], startedAtMs: number): Promise<readonly RecoveryWatchExecutionResult[]> {
    const execution = this.executeDefinitions(definitions, startedAtMs)
    this.inFlight = execution
    void execution.then(() => this.clearInFlight(execution), () => this.clearInFlight(execution))
    return execution
  }

  private clearInFlight(execution: Promise<readonly RecoveryWatchExecutionResult[]>): void { if (this.inFlight === execution) this.inFlight = undefined }

  private async executeDefinitions(definitions: readonly RecoveryWatchDefinition[], startedAtMs: number): Promise<readonly RecoveryWatchExecutionResult[]> {
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
    this.states = this.states.map((state) => !this.matches(state.definition, definition) ? state : {
      definition: state.definition,
      lastStartedAtMs: startedAtMs,
      publicState: { ...state.publicState, lastStartedAt: new Date(startedAtMs).toISOString() },
    })
  }

  private markCompleted(definition: RecoveryWatchDefinition, completedAtMs: number, status: RecoveryRunResult['status']): void {
    this.states = this.states.map((state) => {
      if (!this.matches(state.definition, definition)) return state
      const { lastError: _lastError, ...withoutError } = state.publicState
      return { ...state, publicState: { ...withoutError, lastCompletedAt: new Date(completedAtMs).toISOString(), lastStatus: status } }
    })
  }

  private markFailed(definition: RecoveryWatchDefinition, completedAtMs: number, error: string): void {
    this.states = this.states.map((state) => !this.matches(state.definition, definition) ? state : {
      ...state,
      publicState: { ...state.publicState, lastCompletedAt: new Date(completedAtMs).toISOString(), lastStatus: 'error', lastError: error },
    })
  }

  private newState(definition: RecoveryWatchDefinition): RecoveryWatchRuntimeState {
    return { definition, publicState: { nodeId: definition.nodeId, serviceId: definition.serviceId, intervalMs: definition.intervalMs, lastStatus: 'never_run' } }
  }

  private validateDefinition(definition: RecoveryWatchDefinition): RecoveryWatchDefinition {
    if (definition.nodeId.trim().length === 0 || definition.serviceId.trim().length === 0) throw new Error('Recovery watch target must be non-blank')
    if (!Number.isInteger(definition.intervalMs) || definition.intervalMs <= 0) throw new Error('Recovery watch interval must be a positive integer number of milliseconds')
    return { nodeId: definition.nodeId.trim(), serviceId: definition.serviceId.trim(), intervalMs: definition.intervalMs }
  }

  private matches(left: RecoveryWatchDefinition, right: RecoveryWatchDefinition): boolean { return left.nodeId === right.nodeId && left.serviceId === right.serviceId }
}
