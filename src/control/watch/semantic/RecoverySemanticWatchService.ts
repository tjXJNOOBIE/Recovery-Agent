import { randomUUID } from 'node:crypto'

import type { RecoveryWatchService } from '../RecoveryWatchService.js'
import type {
  IRecoverySemanticWatchCompiler,
  RecoverySemanticWatchDefinition,
  RecoverySemanticWatchTarget,
} from './RecoverySemanticWatch.js'

export interface RecoverySemanticWatchMutation {
  readonly result: RecoverySemanticWatchDefinition
  readonly definitions: readonly RecoverySemanticWatchDefinition[]
}

export class RecoverySemanticWatchService {
  private readonly compiler: IRecoverySemanticWatchCompiler
  private readonly serviceWatches: RecoveryWatchService
  private readonly allowedTargets: ReadonlySet<string> | undefined
  private definitions: RecoverySemanticWatchDefinition[] = []

  public constructor(
    compiler: IRecoverySemanticWatchCompiler,
    serviceWatches: RecoveryWatchService,
    allowedTargets?: readonly RecoverySemanticWatchTarget[],
  ) {
    this.compiler = compiler
    this.serviceWatches = serviceWatches
    this.allowedTargets = allowedTargets === undefined
      ? undefined
      : new Set(allowedTargets.map((target) => this.targetKey(target.nodeId, target.serviceId)))
  }

  public list(): readonly RecoverySemanticWatchDefinition[] { return this.definitions }

  public restore(definitions: readonly RecoverySemanticWatchDefinition[]): void {
    const ids = new Set<string>()
    const targets = new Set<string>()
    const restored = definitions.map((definition, index) => {
      const normalized = this.validateDefinition(definition, index)
      if (ids.has(normalized.watchId)) throw new Error(`Duplicate semantic recovery watch id during restore: ${normalized.watchId}`)
      const target = this.targetKey(normalized.nodeId, normalized.serviceId)
      if (targets.has(target)) throw new Error(`Duplicate semantic recovery watch target during restore: ${target}`)
      ids.add(normalized.watchId)
      targets.add(target)
      return normalized
    })

    for (const current of this.definitions) this.serviceWatches.clearOverride(current.nodeId, current.serviceId)
    for (const definition of restored) this.serviceWatches.upsertOverride(definition)
    this.definitions = restored
  }

  public async prepareCreate(request: string): Promise<RecoverySemanticWatchMutation> {
    const proposal = await this.compiler.compile(request)
    this.requireAllowedTarget(proposal.nodeId, proposal.serviceId)
    const existing = this.findByTarget(proposal.nodeId, proposal.serviceId)
    if (existing !== undefined) throw new Error(`Semantic watch already exists for ${proposal.nodeId}/${proposal.serviceId}; update ${existing.watchId} instead`)
    const now = new Date().toISOString()
    const definition: RecoverySemanticWatchDefinition = {
      watchId: randomUUID(),
      request: request.trim(),
      nodeId: proposal.nodeId,
      serviceId: proposal.serviceId,
      intervalMs: proposal.intervalSeconds * 1_000,
      rationale: proposal.rationale,
      createdAt: now,
      updatedAt: now,
    }
    return { result: definition, definitions: [...this.definitions, definition] }
  }

  public async prepareUpdate(watchId: string, request: string): Promise<RecoverySemanticWatchMutation> {
    const current = this.require(watchId)
    const proposal = await this.compiler.compile(request)
    const latest = this.require(watchId)
    if (latest !== current) {
      throw new Error(`Semantic recovery watch ${current.watchId} changed while update compilation was in flight; retry against the latest state`)
    }
    this.requireAllowedTarget(proposal.nodeId, proposal.serviceId)
    if (proposal.nodeId !== latest.nodeId || proposal.serviceId !== latest.serviceId) throw new Error('Semantic watch update cannot retarget an existing watch; remove it and create another watch')
    const updated: RecoverySemanticWatchDefinition = {
      ...latest,
      request: request.trim(),
      intervalMs: proposal.intervalSeconds * 1_000,
      rationale: proposal.rationale,
      updatedAt: new Date().toISOString(),
    }
    return {
      result: updated,
      definitions: this.definitions.map((definition) => definition.watchId === watchId ? updated : definition),
    }
  }

  public prepareRemove(watchId: string): RecoverySemanticWatchMutation {
    const current = this.require(watchId)
    return { result: current, definitions: this.definitions.filter((definition) => definition.watchId !== current.watchId) }
  }

  public async create(request: string): Promise<RecoverySemanticWatchDefinition> {
    const mutation = await this.prepareCreate(request)
    this.restore(mutation.definitions)
    return mutation.result
  }

  public async update(watchId: string, request: string): Promise<RecoverySemanticWatchDefinition> {
    const mutation = await this.prepareUpdate(watchId, request)
    this.restore(mutation.definitions)
    return mutation.result
  }

  public remove(watchId: string): RecoverySemanticWatchDefinition {
    const mutation = this.prepareRemove(watchId)
    this.restore(mutation.definitions)
    return mutation.result
  }

  private require(watchId: string): RecoverySemanticWatchDefinition {
    const normalized = watchId.trim()
    const definition = this.definitions.find((candidate) => candidate.watchId === normalized)
    if (definition === undefined) throw new Error(`Unknown semantic recovery watch: ${normalized}`)
    return definition
  }

  private findByTarget(nodeId: string, serviceId: string): RecoverySemanticWatchDefinition | undefined {
    return this.definitions.find((definition) => definition.nodeId === nodeId && definition.serviceId === serviceId)
  }

  private validateDefinition(definition: RecoverySemanticWatchDefinition, index: number): RecoverySemanticWatchDefinition {
    const watchId = definition.watchId.trim()
    const nodeId = definition.nodeId.trim()
    const serviceId = definition.serviceId.trim()
    if (watchId.length === 0 || nodeId.length === 0 || serviceId.length === 0) throw new Error(`Recovery semantic watch[${index}] identity and target must be non-blank`)
    if (!Number.isSafeInteger(definition.intervalMs) || definition.intervalMs <= 0) throw new Error(`Recovery semantic watch[${index}] intervalMs must be a positive safe integer`)
    this.requireAllowedTarget(nodeId, serviceId)
    return { ...definition, watchId, nodeId, serviceId }
  }

  private requireAllowedTarget(nodeId: string, serviceId: string): void {
    if (this.allowedTargets === undefined) return
    const target = this.targetKey(nodeId, serviceId)
    if (!this.allowedTargets.has(target)) throw new Error(`Semantic recovery watch target is not configured: ${target}`)
  }

  private targetKey(nodeId: string, serviceId: string): string {
    return `${nodeId.trim()}/${serviceId.trim()}`
  }
}
