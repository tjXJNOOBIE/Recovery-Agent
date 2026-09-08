import type { RecoveryControlRuntime } from '../control/runtime/RecoveryControlRuntime.js'
import type { RecoveryWatchService } from '../control/watch/RecoveryWatchService.js'

export interface McpToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

export class RecoveryMcpToolRouter {
  private readonly controlRuntime: RecoveryControlRuntime
  private readonly watchService: RecoveryWatchService

  public constructor(controlRuntime: RecoveryControlRuntime, watchService: RecoveryWatchService) {
    this.controlRuntime = controlRuntime
    this.watchService = watchService
  }

  public listTools(): readonly McpToolDefinition[] {
    return [
      { name: 'fleet_status', description: 'Inspect current node and service health.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'service_inspect', description: 'Inspect one configured service.', inputSchema: this.nodeServiceSchema() },
      { name: 'service_recover', description: 'Run bounded policy-controlled recovery for one configured service.', inputSchema: this.nodeServiceSchema() },
      { name: 'health_sweep', description: 'Check configured services and recover unhealthy services within policy.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'watch_list', description: 'List configured built-in recovery watches and their latest runtime state.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'watch_run', description: 'Run every configured recovery watch immediately through the same bounded recovery path.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'incident_list', description: 'List recovery incidents from this control runtime.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'incident_inspect', description: 'Inspect one recovery incident and its timeline.', inputSchema: { type: 'object', properties: { incidentId: { type: 'string' } }, required: ['incidentId'], additionalProperties: false } },
    ]
  }

  public async callTool(name: string, args: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    switch (name) {
      case 'fleet_status': return this.controlRuntime.fleetStatus()
      case 'service_inspect': return this.controlRuntime.inspectService(this.requireString(args, 'nodeId'), this.requireString(args, 'serviceId'))
      case 'service_recover': return this.controlRuntime.recoverService(this.requireString(args, 'nodeId'), this.requireString(args, 'serviceId'))
      case 'health_sweep': return this.controlRuntime.healthSweep()
      case 'watch_list': return this.watchService.listStates()
      case 'watch_run': return this.watchService.runAllNow()
      case 'incident_list': return this.controlRuntime.listIncidents()
      case 'incident_inspect': return this.controlRuntime.inspectIncident(this.requireString(args, 'incidentId'))
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

  private requireString(args: Readonly<Record<string, unknown>>, key: string): string {
    const value = args[key]
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`MCP argument ${key} must be a non-blank string`)
    }
    return value.trim()
  }
}
