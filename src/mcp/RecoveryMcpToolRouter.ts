import type { RecoveryControlRuntime } from '../control/runtime/RecoveryControlRuntime.js'
import type { RecoveryWatchSurface } from '../control/watch/RecoveryWatchSurface.js'
import type { RecoverySemanticWatchService } from '../control/watch/semantic/RecoverySemanticWatchService.js'

export interface McpToolDefinition { readonly name: string; readonly description: string; readonly inputSchema: Readonly<Record<string, unknown>> }

export class RecoveryMcpToolRouter {
  private readonly controlRuntime: RecoveryControlRuntime
  private readonly watchSurface: RecoveryWatchSurface
  private readonly semanticWatches: RecoverySemanticWatchService | undefined

  public constructor(controlRuntime: RecoveryControlRuntime, watchSurface: RecoveryWatchSurface, semanticWatches?: RecoverySemanticWatchService) {
    this.controlRuntime = controlRuntime
    this.watchSurface = watchSurface
    this.semanticWatches = semanticWatches
  }

  public listTools(): readonly McpToolDefinition[] {
    return [
      { name: 'fleet_status', description: 'Inspect reachable node/service health and report unreachable nodes without hiding the rest of the fleet.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'recovery_readiness', description: 'Inspect whether configured services can be recovered right now and what is blocking automatic recovery.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'node_inspect', description: 'Inspect one configured node.', inputSchema: this.idSchema('nodeId') },
      { name: 'service_inspect', description: 'Inspect one configured service.', inputSchema: this.nodeServiceSchema() },
      { name: 'service_recover', description: 'Run bounded policy-controlled recovery for one configured service.', inputSchema: this.nodeServiceSchema() },
      { name: 'health_sweep', description: 'Check reachable configured services and recover unhealthy services within policy.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'watch_list', description: 'List built-in recovery watch state, semantic watch overrides, and watch incidents.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'watch_run', description: 'Run built-in deterministic watches immediately.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'watch_create', description: 'Compile one natural-language service recovery watch into a deterministic interval override.', inputSchema: this.requestSchema() },
      { name: 'watch_update', description: 'Recompile and update one semantic service recovery watch without retargeting it.', inputSchema: this.watchUpdateSchema() },
      { name: 'watch_remove', description: 'Remove one semantic watch and restore the configured built-in service watch behavior.', inputSchema: this.idSchema('watchId') },
      { name: 'incident_list', description: 'List recovery incidents from this control runtime.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'incident_inspect', description: 'Inspect one recovery incident and its timeline.', inputSchema: this.idSchema('incidentId') },
      { name: 'incident_postmortem', description: 'Generate a structured evidence-bound postmortem for one resolved incident.', inputSchema: this.idSchema('incidentId') },
      { name: 'recovery_plan_list', description: 'List typed recovery plans proposed after bounded automatic recovery is exhausted.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'recovery_plan_inspect', description: 'Inspect one typed recovery plan and its approval status.', inputSchema: this.idSchema('planId') },
    ]
  }

  public async callTool(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    switch (name) {
      case 'fleet_status': return this.controlRuntime.fleetStatus()
      case 'recovery_readiness': return this.controlRuntime.inspectRecoveryReadiness()
      case 'node_inspect': return this.controlRuntime.inspectNode(this.requireString(args, 'nodeId'))
      case 'service_inspect': return this.controlRuntime.inspectService(this.requireString(args, 'nodeId'), this.requireString(args, 'serviceId'))
      case 'service_recover': return this.controlRuntime.recoverService(this.requireString(args, 'nodeId'), this.requireString(args, 'serviceId'))
      case 'health_sweep': return this.controlRuntime.healthSweep()
      case 'watch_list': return this.listWatches()
      case 'watch_run': return this.watchSurface.runAllNow()
      case 'watch_create': return this.requireSemanticWatches().create(this.requireString(args, 'request'))
      case 'watch_update': return this.requireSemanticWatches().update(this.requireString(args, 'watchId'), this.requireString(args, 'request'))
      case 'watch_remove': return this.requireSemanticWatches().remove(this.requireString(args, 'watchId'))
      case 'incident_list': return this.controlRuntime.listIncidents()
      case 'incident_inspect': return this.controlRuntime.inspectIncident(this.requireString(args, 'incidentId'))
      case 'incident_postmortem': return this.controlRuntime.generateIncidentPostmortem(this.requireString(args, 'incidentId'))
      case 'recovery_plan_list': return this.controlRuntime.listRecoveryPlans()
      case 'recovery_plan_inspect': return this.controlRuntime.inspectRecoveryPlan(this.requireString(args, 'planId'))
      default: throw new Error(`Unknown Recovery Agent MCP tool: ${name}`)
    }
  }

  private listWatches(): unknown {
    const builtIn = this.watchSurface.listStates()
    if (this.semanticWatches === undefined) return builtIn
    if (typeof builtIn === 'object' && builtIn !== null && !Array.isArray(builtIn)) return { ...(builtIn as Readonly<Record<string, unknown>>), semanticWatches: this.semanticWatches.list() }
    return { builtIn, semanticWatches: this.semanticWatches.list() }
  }

  private requireSemanticWatches(): RecoverySemanticWatchService {
    if (this.semanticWatches === undefined) throw new Error('Semantic recovery watches are not configured')
    return this.semanticWatches
  }

  private nodeServiceSchema(): Readonly<Record<string, unknown>> { return { type: 'object', properties: { nodeId: { type: 'string' }, serviceId: { type: 'string' } }, required: ['nodeId', 'serviceId'], additionalProperties: false } }
  private requestSchema(): Readonly<Record<string, unknown>> { return { type: 'object', properties: { request: { type: 'string' } }, required: ['request'], additionalProperties: false } }
  private watchUpdateSchema(): Readonly<Record<string, unknown>> { return { type: 'object', properties: { watchId: { type: 'string' }, request: { type: 'string' } }, required: ['watchId', 'request'], additionalProperties: false } }
  private idSchema(key: string): Readonly<Record<string, unknown>> { return { type: 'object', properties: { [key]: { type: 'string' } }, required: [key], additionalProperties: false } }
  private requireString(args: Readonly<Record<string, unknown>>, key: string): string { const value = args[key]; if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`MCP argument ${key} must be a non-blank string`); return value.trim() }
}
