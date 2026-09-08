#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { StrandsAgentRuntimeBootstrap } from '@tjxjnoobie/custom-strands-bridge'

import { RecoveryAgentRuntimeConfigBuilder } from '../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryControlConfigReader } from '../config/RecoveryControlConfig.js'
import { RecoveryNodeConfigReader } from '../config/RecoveryNodeConfig.js'
import { RecoveryApprovalSocketClient } from '../control/approval/socket/RecoveryApprovalSocketClient.js'
import { RecoveryApprovalSocketPathResolver } from '../control/approval/socket/RecoveryApprovalSocketPathResolver.js'
import { RecoveryApprovalSocketServer } from '../control/approval/socket/RecoveryApprovalSocketServer.js'
import { RecoveryControlRuntimeBuilder } from '../control/runtime/RecoveryControlRuntimeBuilder.js'
import { RecoveryWatchCoordinator } from '../control/watch/RecoveryWatchCoordinator.js'
import { RecoveryWatchDefinitionBuilder } from '../control/watch/RecoveryWatchDefinitionBuilder.js'
import { RecoveryWatchService } from '../control/watch/RecoveryWatchService.js'
import { RecoveryCertificateWatchService } from '../control/watch/certificate/RecoveryCertificateWatchService.js'
import { RecoveryDeploymentWatchService } from '../control/watch/deployment/RecoveryDeploymentWatchService.js'
import { RecoveryNodeWatchDefinitionBuilder } from '../control/watch/node/RecoveryNodeWatchDefinitionBuilder.js'
import { RecoveryNodeWatchService } from '../control/watch/node/RecoveryNodeWatchService.js'
import { RecoveryReadinessWatchService } from '../control/watch/readiness/RecoveryReadinessWatchService.js'
import { RecoveryDemoHandler } from '../demo/RecoveryDemoHandler.js'
import { RecoveryMcpToolRouter } from '../mcp/RecoveryMcpToolRouter.js'
import { RecoveryMcpServer } from '../mcp/RecoveryMcpServer.js'
import { NodeCertificateProbe } from '../node/certificate/NodeCertificateProbe.js'
import { LinuxNodeResourceProbe } from '../node/health/LinuxNodeResourceProbe.js'
import { NodeAgentHttpServer } from '../node/http/NodeAgentHttpServer.js'
import { SystemdNodeServiceRuntime } from '../node/systemd/SystemdNodeServiceRuntime.js'
import { RecoveryAgentCliHandler } from './RecoveryAgentCliHandler.js'

function resolveRequest(arguments_: string[]): string { const argumentRequest = arguments_.join(' ').trim(); if (argumentRequest.length > 0) return argumentRequest; if (process.stdin.isTTY === true) return ''; return readFileSync(0, 'utf8').trim() }
function requireArgument(args: readonly string[], index: number, label: string): string { const value = args[index]?.trim(); if (value === undefined || value.length === 0) throw new Error(`${label} is required`); return value }
function requireApprovalToken(): string { const token = process.env['RECOVERY_APPROVAL_TOKEN']?.trim(); if (token === undefined || token.length < 16) throw new Error('RECOVERY_APPROVAL_TOKEN must contain at least 16 characters'); return token }

async function main(): Promise<void> {
  const args = process.argv.slice(2); const command = args[0]
  if (command === 'demo') { process.stdout.write(`${JSON.stringify(await new RecoveryDemoHandler().run(), null, 2)}\n`); return }
  if (command === 'approve' || command === 'reject') { const planId = requireArgument(args, 1, 'recovery plan ID'); const client = new RecoveryApprovalSocketClient(new RecoveryApprovalSocketPathResolver().resolve(process.env), requireApprovalToken()); const result = command === 'approve' ? await client.approve(planId) : await client.reject(planId, args.slice(2).join(' ')); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return }
  if (command === 'node') {
    const config = new RecoveryNodeConfigReader().read(requireArgument(args, 1, 'node config path')); const token = process.env[config.tokenEnvironmentVariable]?.trim(); if (token === undefined || token.length < 16) throw new Error(`Environment variable ${config.tokenEnvironmentVariable} must contain a node token of at least 16 characters`)
    const server = new NodeAgentHttpServer(new SystemdNodeServiceRuntime(config.nodeId, config.services), token, new LinuxNodeResourceProbe(), new NodeCertificateProbe(config.nodeId, config.certificates)); const address = await server.listen(config.listenPort, config.listenHost); process.stderr.write(`Recovery node ${config.nodeId} listening on ${address.baseUrl}\n`)
    await new Promise<void>((resolve) => { const stop = (): void => { void server.close().finally(resolve) }; process.once('SIGINT', stop); process.once('SIGTERM', stop) }); return
  }
  if (command === 'mcp') {
    const config = new RecoveryControlConfigReader().read(requireArgument(args, 1, 'control config path')); const bootstrap = new StrandsAgentRuntimeBootstrap(); const control = new RecoveryControlRuntimeBuilder(bootstrap, process.env).build(config)
    const serviceWatches = new RecoveryWatchService(control, new RecoveryWatchDefinitionBuilder().build(config)); const nodeWatches = new RecoveryNodeWatchService(control, new RecoveryNodeWatchDefinitionBuilder().build(config)); const readinessWatch = new RecoveryReadinessWatchService(control); const certificateWatch = new RecoveryCertificateWatchService(control, config.nodes.map((node) => node.id)); const deploymentWatch = new RecoveryDeploymentWatchService(control)
    const watches = new RecoveryWatchCoordinator(serviceWatches, nodeWatches, 1_000, readinessWatch, certificateWatch, deploymentWatch); const mcpServer = new RecoveryMcpServer(new RecoveryMcpToolRouter(control, watches))
    const approvalToken = process.env['RECOVERY_APPROVAL_TOKEN']?.trim(); const approvalServer = approvalToken === undefined || approvalToken.length === 0 ? undefined : new RecoveryApprovalSocketServer(control, new RecoveryApprovalSocketPathResolver().resolve(process.env))
    if (approvalServer !== undefined) { await approvalServer.listen(); process.stderr.write(`Recovery approval socket listening at ${new RecoveryApprovalSocketPathResolver().resolve(process.env)}\n`) }
    watches.start(); mcpServer.serve()
    await new Promise<void>((resolve, reject) => { let closing = false; const stop = (): void => { if (closing) return; closing = true; void mcpServer.close().then(() => watches.close()).then(() => approvalServer?.close()).then(() => control.close()).then(resolve, reject) }; process.once('SIGINT', stop); process.once('SIGTERM', stop); process.stdin.once('end', stop) }); return
  }
  const bootstrap = new StrandsAgentRuntimeBootstrap(); const result = await new RecoveryAgentCliHandler(bootstrap, new RecoveryAgentRuntimeConfigBuilder(process.env)).handle(resolveRequest(args)); process.stdout.write(`${result}\n`)
}

main().catch((error: unknown) => { const message = error instanceof Error ? error.message : String(error); process.stderr.write(`${message}\n`); process.exitCode = 1 })
