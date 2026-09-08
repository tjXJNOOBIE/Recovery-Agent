import type { RecoveryControlRuntime } from '../control/runtime/RecoveryControlRuntime.js'
import type { RecoveryWatchSurface } from '../control/watch/RecoveryWatchSurface.js'

export interface McpToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

export class RecoveryMcpToolRouter {
  private readonly controlRuntime: RecoveryControlRuntime
  private readonly watchSurface: RecoveryWatchSurface

  public constructor(controlRuntime: RecoveryControlRuntime, watchSurface: RecoveryWatchSurface) {
    this.controlRuntime = controlRuntime
    this.watchSurface = watchSurface
  }

  public listTools(): readonly McpToolDefinition[] {
    return [
      { name: 'fleet_status', description: 'Inspect reachable node/service health and report unreachable nodes without hiding the rest of the fleet.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'recovery_readiness', description: 'Inspect whether configured services can be recovered right now and what is blocking automatic recovery.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'node_inspect', description: 'Inspect one configured node.', inputSchema: this.idSchema('nodeId') },
      { name: 'service_inspect', description: 'Inspect one configured service.', inputSchema: this.nodeServiceSchema() },
      { name: 'service_recover', description: 'Run bounded policy-controlled recovery for one configured service.', inputSchema: this.nodeServiceSchema() },
      { name: 'health_sweep', description: 'Check reachable configured services and recover unhealthy services within policy.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'watch_list', description: 'List built-in service/node/readiness watches, node-health incidents, and latest runtime state.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'watch_run', description: 'Run built-in node, service, and readiness watches immediately through deterministic watch paths.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'incident_list', description: 'List recovery incidents from this control runtime.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'incident_inspect', description: 'Inspect one recovery incident and its timeline.', inputSchema: this.idSchema('incidentId') },
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
      case 'watch_list': return this.watchSurface.listStates()
      case 'watch_run': return this.watchSurface.runAllNow()
      case 'incident_list': return this.controlRuntime.listIncidents()
      case 'incident_inspect': return this.controlRuntime.inspectIncident(this.requireString(args, 'incidentId'))
      case 'recovery_plan_list': return this.controlRuntime.listRecoveryPlans()
      case 'recovery_plan_inspect': return this.controlRuntime.inspectRecoveryPlan(this.requireString(args, 'planId'))
      default: throw new Error(`Unknown Recovery Agent MCP tool: ${name}`)
    }
  }

  private nodeServiceSchema(): Readonly<Record<string, unknown>> {
    return {
      type: 'object',
      properties: { nodeId: { type: 'string' }, serviceId: { type: 'string' } },
      required: ['nodeId', 'serviceId'],
      additionalProperties: false,
    }
  }

  private idSchema(key: string): Readonly<Record<string, unknown>> {
    return {
      type: 'object',
      properties: { [key]: { type: 'string' } },
      required: [key],
      additionalProperties: false,
    }
  }

  private requireString(args: Readonly<Record<string, unknown>>, key: string): string {
    const value = args[key]
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`MCP argument ${key} must be a non-blank string`)
    return value.trim()
  }
}
