import { randomUUID } from 'node:crypto'

import type { RecoveryWatchService } from '../RecoveryWatchService.js'
import type { IRecoverySemanticWatchCompiler, RecoverySemanticWatchDefinition } from './RecoverySemanticWatch.js'

export class RecoverySemanticWatchService {
  private readonly compiler: IRecoverySemanticWatchCompiler
  private readonly serviceWatches: RecoveryWatchService
  private definitions: RecoverySemanticWatchDefinition[] = []

  public constructor(compiler: IRecoverySemanticWatchCompiler, serviceWatches: RecoveryWatchService) {
    this.compiler = compiler
    this.serviceWatches = serviceWatches
  }

  public list(): readonly RecoverySemanticWatchDefinition[] { return this.definitions }

  public async create(request: string): Promise<RecoverySemanticWatchDefinition> {
    const proposal = await this.compiler.compile(request)
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
    this.serviceWatches.upsertOverride(definition)
    this.definitions = [...this.definitions, definition]
    return definition
  }

  public async update(watchId: string, request: string): Promise<RecoverySemanticWatchDefinition> {
    const current = this.require(watchId)
    const proposal = await this.compiler.compile(request)
    if (proposal.nodeId !== current.nodeId || proposal.serviceId !== current.serviceId) throw new Error('Semantic watch update cannot retarget an existing watch; remove it and create another watch')
    const updated: RecoverySemanticWatchDefinition = {
      ...current,
      request: request.trim(),
      intervalMs: proposal.intervalSeconds * 1_000,
      rationale: proposal.rationale,
      updatedAt: new Date().toISOString(),
    }
    this.serviceWatches.upsertOverride(updated)
    this.definitions = this.definitions.map((definition) => definition.watchId === watchId ? updated : definition)
    return updated
  }

  public remove(watchId: string): RecoverySemanticWatchDefinition {
    const current = this.require(watchId)
    this.serviceWatches.clearOverride(current.nodeId, current.serviceId)
    this.definitions = this.definitions.filter((definition) => definition.watchId !== watchId)
    return current
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
}
