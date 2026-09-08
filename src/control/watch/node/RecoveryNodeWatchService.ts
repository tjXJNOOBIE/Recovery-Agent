import type { NodeSnapshot } from '../../../node/data/ServiceSnapshot.js'
import { InMemoryNodeHealthIncidentRepository } from './InMemoryNodeHealthIncidentRepository.js'
import { RecoveryNodeResourceEvaluator } from './RecoveryNodeResourceEvaluator.js'
import {
  DEFAULT_RECOVERY_NODE_MAX_CLOCK_DRIFT_MS,
  type RecoveryNodeResourceViolation,
  type RecoveryNodeWatchDefinition,
  type RecoveryNodeWatchState,
} from './RecoveryNodeWatchDefinition.js'

export interface RecoveryNodeInspectionRuntime {
  inspectNode(nodeId: string): Promise<NodeSnapshot>
}

export type RecoveryNodeWatchClock = () => number

interface RecoveryNodeWatchRuntimeState {
  readonly definition: RecoveryNodeWatchDefinition
  readonly lastStartedAtMs?: number
  readonly publicState: RecoveryNodeWatchState
}

export interface RecoveryNodeWatchExecutionResult {
  readonly nodeId: string
  readonly state: RecoveryNodeWatchState
}

export class RecoveryNodeWatchService {
  private readonly controlRuntime: RecoveryNodeInspectionRuntime
  private readonly evaluator: RecoveryNodeResourceEvaluator
  private readonly incidentRepository: InMemoryNodeHealthIncidentRepository
  private readonly clock: RecoveryNodeWatchClock
  private states: readonly RecoveryNodeWatchRuntimeState[]
  private inFlight: Promise<readonly RecoveryNodeWatchExecutionResult[]> | undefined

  public constructor(
    controlRuntime: RecoveryNodeInspectionRuntime,
    definitions: readonly RecoveryNodeWatchDefinition[],
    evaluator = new RecoveryNodeResourceEvaluator(),
    incidentRepository = new InMemoryNodeHealthIncidentRepository(),
    clock: RecoveryNodeWatchClock = Date.now,
  ) {
    this.controlRuntime = controlRuntime
    this.evaluator = evaluator
    this.incidentRepository = incidentRepository
    this.clock = clock
    this.states = definitions.map((definition) => ({
      definition,
      publicState: {
        nodeId: definition.nodeId,
        intervalMs: definition.intervalMs,
        lastStatus: 'never_run',
        violations: [],
      },
    }))
  }

  public listStates(): readonly RecoveryNodeWatchState[] {
    return this.states.map((state) => state.publicState)
  }

  public listIncidents() {
    return this.incidentRepository.list()
  }

  public runDueWatches(nowMs = Date.now()): Promise<readonly RecoveryNodeWatchExecutionResult[]> {
    if (this.inFlight !== undefined) return this.inFlight
    const due = this.states
      .filter((state) => state.lastStartedAtMs === undefined || nowMs - state.lastStartedAtMs >= state.definition.intervalMs)
      .map((state) => state.definition)
    return this.beginExecution(due, nowMs)
  }

  public async runAllNow(nowMs = Date.now()): Promise<readonly RecoveryNodeWatchExecutionResult[]> {
    if (this.inFlight !== undefined) await this.inFlight
    return this.beginExecution(this.states.map((state) => state.definition), nowMs)
  }

  public async close(): Promise<void> {
    if (this.inFlight !== undefined) await this.inFlight
  }

  private beginExecution(
    definitions: readonly RecoveryNodeWatchDefinition[],
    startedAtMs: number,
  ): Promise<readonly RecoveryNodeWatchExecutionResult[]> {
    const execution = this.executeDefinitions(definitions, startedAtMs)
    this.inFlight = execution
    void execution.then(
      () => this.clearInFlight(execution),
      () => this.clearInFlight(execution),
    )
    return execution
  }

  private clearInFlight(execution: Promise<readonly RecoveryNodeWatchExecutionResult[]>): void {
    if (this.inFlight === execution) this.inFlight = undefined
  }

  private async executeDefinitions(
    definitions: readonly RecoveryNodeWatchDefinition[],
    startedAtMs: number,
  ): Promise<readonly RecoveryNodeWatchExecutionResult[]> {
    const results: RecoveryNodeWatchExecutionResult[] = []
    for (const definition of definitions) {
      this.markStarted(definition, startedAtMs)
      const state = await this.inspectDefinition(definition, startedAtMs)
      this.replacePublicState(definition, state, startedAtMs)
      results.push({ nodeId: definition.nodeId, state })
    }
    return results
  }

  private async inspectDefinition(
    definition: RecoveryNodeWatchDefinition,
    completedAtMs: number,
  ): Promise<RecoveryNodeWatchState> {
    try {
      const requestStartedAtMs = this.now()
      const snapshot = await this.controlRuntime.inspectNode(definition.nodeId)
      const requestCompletedAtMs = this.now()
      const requestRoundTripMs = Math.max(0, requestCompletedAtMs - requestStartedAtMs)
      const midpointMs = requestStartedAtMs + (requestRoundTripMs / 2)
      const observedAtMs = Date.parse(snapshot.observedAt)
      const clockDriftMs = Number.isFinite(observedAtMs)
        ? Math.round(Math.abs(observedAtMs - midpointMs))
        : undefined
      const maxClockDriftMs = definition.maxClockDriftMs ?? DEFAULT_RECOVERY_NODE_MAX_CLOCK_DRIFT_MS
      if (!Number.isFinite(maxClockDriftMs) || maxClockDriftMs < 0) {
        throw new Error('Recovery node max clock drift must be a finite non-negative number of milliseconds')
      }

      if (snapshot.resources === undefined) {
        const openIncident = this.incidentRepository.findOpen(definition.nodeId)
        return {
          nodeId: definition.nodeId,
          intervalMs: definition.intervalMs,
          lastStatus: 'unsupported',
          lastCompletedAt: new Date(completedAtMs).toISOString(),
          requestRoundTripMs,
          ...(clockDriftMs === undefined ? {} : { clockDriftMs }),
          violations: [],
          ...(openIncident === undefined ? {} : { incidentId: openIncident.id }),
        }
      }

      const violations: RecoveryNodeResourceViolation[] = [
        ...this.evaluator.evaluate(snapshot.resources, definition.thresholds),
      ]
      if (clockDriftMs !== undefined && clockDriftMs > maxClockDriftMs) {
        violations.push({
          metric: 'node_clock_drift_ms',
          value: clockDriftMs,
          threshold: maxClockDriftMs,
        })
      }

      if (violations.length === 0) {
        this.incidentRepository.resolve(definition.nodeId, 'Node resource/filesystem/clock pressure cleared after fresh deterministic inspection')
        return {
          nodeId: definition.nodeId,
          intervalMs: definition.intervalMs,
          lastStatus: 'healthy',
          lastCompletedAt: new Date(completedAtMs).toISOString(),
          resources: snapshot.resources,
          requestRoundTripMs,
          ...(clockDriftMs === undefined ? {} : { clockDriftMs }),
          violations: [],
        }
      }

      const incident = this.incidentRepository.openOrUpdate(
        definition.nodeId,
        violations,
        `Node pressure detected: ${violations.map((violation) => this.describeViolation(violation)).join(', ')}`,
      )
      return {
        nodeId: definition.nodeId,
        intervalMs: definition.intervalMs,
        lastStatus: 'degraded',
        lastCompletedAt: new Date(completedAtMs).toISOString(),
        resources: snapshot.resources,
        requestRoundTripMs,
        ...(clockDriftMs === undefined ? {} : { clockDriftMs }),
        violations,
        incidentId: incident.id,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const incident = this.incidentRepository.openOrUpdate(
        definition.nodeId,
        [],
        `Node unreachable during deterministic watch: ${message}`,
      )
      return {
        nodeId: definition.nodeId,
        intervalMs: definition.intervalMs,
        lastStatus: 'unreachable',
        lastCompletedAt: new Date(completedAtMs).toISOString(),
        violations: [],
        incidentId: incident.id,
        lastError: message,
      }
    }
  }

  private describeViolation(violation: RecoveryNodeResourceViolation): string {
    return violation.metric === 'root_filesystem_read_only'
      ? 'root_filesystem_read_only=true; expected=false'
      : `${violation.metric}=${violation.value}>${violation.threshold}`
  }

  private markStarted(definition: RecoveryNodeWatchDefinition, startedAtMs: number): void {
    this.states = this.states.map((state) => {
      if (state.definition.nodeId !== definition.nodeId) return state
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

  private replacePublicState(
    definition: RecoveryNodeWatchDefinition,
    publicState: RecoveryNodeWatchState,
    startedAtMs: number,
  ): void {
    this.states = this.states.map((state) => state.definition.nodeId === definition.nodeId
      ? {
          definition: state.definition,
          lastStartedAtMs: startedAtMs,
          publicState: {
            ...publicState,
            lastStartedAt: new Date(startedAtMs).toISOString(),
          },
        }
      : state)
  }

  private now(): number {
    const value = this.clock()
    if (!Number.isFinite(value)) throw new Error('Recovery node watch clock must return a finite timestamp')
    return value
  }
}
