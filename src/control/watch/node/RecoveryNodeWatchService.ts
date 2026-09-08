import type { NodeSnapshot } from '../../../node/data/ServiceSnapshot.js'
import { InMemoryNodeHealthIncidentRepository } from './InMemoryNodeHealthIncidentRepository.js'
import { RecoveryNodeResourceEvaluator } from './RecoveryNodeResourceEvaluator.js'
import type {
  RecoveryNodeResourceViolation,
  RecoveryNodeWatchDefinition,
  RecoveryNodeWatchState,
} from './RecoveryNodeWatchDefinition.js'

export interface RecoveryNodeInspectionRuntime {
  inspectNode(nodeId: string): Promise<NodeSnapshot>
}

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
  private states: readonly RecoveryNodeWatchRuntimeState[]
  private inFlight: Promise<readonly RecoveryNodeWatchExecutionResult[]> | undefined

  public constructor(
    controlRuntime: RecoveryNodeInspectionRuntime,
    definitions: readonly RecoveryNodeWatchDefinition[],
    evaluator = new RecoveryNodeResourceEvaluator(),
    incidentRepository = new InMemoryNodeHealthIncidentRepository(),
  ) {
    this.controlRuntime = controlRuntime
    this.evaluator = evaluator
    this.incidentRepository = incidentRepository
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
      const snapshot = await this.controlRuntime.inspectNode(definition.nodeId)
      if (snapshot.resources === undefined) {
        const openIncident = this.incidentRepository.findOpen(definition.nodeId)
        return {
          nodeId: definition.nodeId,
          intervalMs: definition.intervalMs,
          lastStatus: 'unsupported',
          lastCompletedAt: new Date(completedAtMs).toISOString(),
          violations: [],
          ...(openIncident === undefined ? {} : { incidentId: openIncident.id }),
        }
      }

      const violations = this.evaluator.evaluate(snapshot.resources, definition.thresholds)
      if (violations.length === 0) {
        this.incidentRepository.resolve(definition.nodeId, 'Node resource pressure cleared after fresh deterministic inspection')
        return {
          nodeId: definition.nodeId,
          intervalMs: definition.intervalMs,
          lastStatus: 'healthy',
          lastCompletedAt: new Date(completedAtMs).toISOString(),
          resources: snapshot.resources,
          violations: [],
        }
      }

      const incident = this.incidentRepository.openOrUpdate(
        definition.nodeId,
        violations,
        `Node resource pressure detected: ${violations.map((violation) => this.describeViolation(violation)).join(', ')}`,
      )
      return {
        nodeId: definition.nodeId,
        intervalMs: definition.intervalMs,
        lastStatus: 'degraded',
        lastCompletedAt: new Date(completedAtMs).toISOString(),
        resources: snapshot.resources,
        violations,
        incidentId: incident.id,
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const incident = this.incidentRepository.openOrUpdate(
        definition.nodeId,
        [],
        `Node unreachable during resource watch: ${message}`,
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
}
