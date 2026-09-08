import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

import type { RecoveryMcpToolRouter } from './RecoveryMcpToolRouter.js'

const emptyInputSchema = z.object({}).strict()
const nodeInputSchema = z.object({ nodeId: z.string().trim().min(1) }).strict()
const nodeServiceInputSchema = z.object({
  nodeId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1),
}).strict()
const incidentInputSchema = z.object({ incidentId: z.string().trim().min(1) }).strict()
const planInputSchema = z.object({ planId: z.string().trim().min(1) }).strict()

export class RecoveryMcpServer {
  private readonly toolRouter: RecoveryMcpToolRouter
  private handle: StdioServerHandle | undefined

  public constructor(toolRouter: RecoveryMcpToolRouter) {
    this.toolRouter = toolRouter
  }

  public serve(): void {
    if (this.handle !== undefined) throw new Error('Recovery MCP server is already serving')
    this.handle = serveStdio(() => this.createServer())
  }

  public async close(): Promise<void> {
    const handle = this.handle
    this.handle = undefined
    if (handle !== undefined) await handle.close()
  }

  private createServer(): McpServer {
    const server = new McpServer({ name: 'recovery-agent', version: '0.1.0' })

    server.registerTool('fleet_status', {
      description: 'Inspect reachable node/service health and report unreachable nodes without hiding the rest of the fleet.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    }, async () => this.toolResult(await this.toolRouter.callTool('fleet_status')))

    server.registerTool('node_inspect', {
      description: 'Inspect one configured node.',
      inputSchema: nodeInputSchema,
      annotations: { readOnlyHint: true },
    }, async ({ nodeId }) => this.toolResult(await this.toolRouter.callTool('node_inspect', { nodeId })))

    server.registerTool('service_inspect', {
      description: 'Inspect one configured service.', inputSchema: nodeServiceInputSchema, annotations: { readOnlyHint: true },
    }, async ({ nodeId, serviceId }) => this.toolResult(await this.toolRouter.callTool('service_inspect', { nodeId, serviceId })))

    server.registerTool('service_recover', {
      description: 'Run bounded policy-controlled recovery for one configured service.', inputSchema: nodeServiceInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async ({ nodeId, serviceId }) => this.toolResult(await this.toolRouter.callTool('service_recover', { nodeId, serviceId })))

    server.registerTool('health_sweep', {
      description: 'Check reachable configured services and recover unhealthy services within policy.', inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async () => this.toolResult(await this.toolRouter.callTool('health_sweep')))

    server.registerTool('watch_list', {
      description: 'List configured built-in recovery watches and their latest runtime state.', inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    }, async () => this.toolResult(await this.toolRouter.callTool('watch_list')))

    server.registerTool('watch_run', {
      description: 'Run every configured recovery watch immediately through bounded recovery policy.', inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async () => this.toolResult(await this.toolRouter.callTool('watch_run')))

    server.registerTool('recovery_plan_list', {
      description: 'List typed recovery plans proposed after automatic recovery is exhausted.', inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    }, async () => this.toolResult(await this.toolRouter.callTool('recovery_plan_list')))

    server.registerTool('recovery_plan_inspect', {
      description: 'Inspect one typed recovery plan and its approval status.', inputSchema: planInputSchema,
      annotations: { readOnlyHint: true },
    }, async ({ planId }) => this.toolResult(await this.toolRouter.callTool('recovery_plan_inspect', { planId })))

    server.registerTool('incident_list', {
      description: 'List recovery incidents from this control runtime.', inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    }, async () => this.toolResult(await this.toolRouter.callTool('incident_list')))

    server.registerTool('incident_inspect', {
      description: 'Inspect one recovery incident and its timeline.', inputSchema: incidentInputSchema,
      annotations: { readOnlyHint: true },
    }, async ({ incidentId }) => this.toolResult(await this.toolRouter.callTool('incident_inspect', { incidentId })))

    return server
  }

  private toolResult(value: unknown): { content: { type: 'text'; text: string }[] } {
    return { content: [{ type: 'text', text: JSON.stringify(value) ?? 'null' }] }
  }
}
