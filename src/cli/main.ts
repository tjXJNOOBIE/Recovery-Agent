#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StrandsAgentRuntimeBootstrap } from '@tjxjnoobie/strands-bridge'

import { RecoveryAgentRuntimeConfigBuilder } from '../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryControlConfigReader } from '../config/RecoveryControlConfig.js'
import { RecoveryNodeConfigReader } from '../config/RecoveryNodeConfig.js'
import { RecoveryApprovalSocketClient } from '../control/approval/socket/RecoveryApprovalSocketClient.js'
import { RecoveryApprovalSocketPathResolver } from '../control/approval/socket/RecoveryApprovalSocketPathResolver.js'
import { RecoveryApprovalSocketServer } from '../control/approval/socket/RecoveryApprovalSocketServer.js'
import { RecoveryDurabilityCheckpointBarrier } from '../control/durability/RecoveryDurabilityCheckpointBarrier.js'
import { RecoveryDurableRetentionService } from '../control/durability/RecoveryDurableRetentionService.js'
import { RecoveryDurableStateCoordinator } from '../control/durability/RecoveryDurableStateCoordinator.js'
import { RecoveryStateAuthorityProcessClient } from '../control/durability/RecoveryStateAuthorityProcessClient.js'
import { RecoveryControlRuntimeBuilder } from '../control/runtime/RecoveryControlRuntimeBuilder.js'
import { RecoveryWatchCoordinator } from '../control/watch/RecoveryWatchCoordinator.js'
import { RecoveryWatchDefinitionBuilder } from '../control/watch/RecoveryWatchDefinitionBuilder.js'
import { RecoveryWatchService } from '../control/watch/RecoveryWatchService.js'
import { RecoveryCertificateWatchService } from '../control/watch/certificate/RecoveryCertificateWatchService.js'
import { RecoveryDeploymentWatchService } from '../control/watch/deployment/RecoveryDeploymentWatchService.js'
import { RecoveryNodeWatchDefinitionBuilder } from '../control/watch/node/RecoveryNodeWatchDefinitionBuilder.js'
import { RecoveryNodeWatchService } from '../control/watch/node/RecoveryNodeWatchService.js'
import { RecoveryReadinessWatchService } from '../control/watch/readiness/RecoveryReadinessWatchService.js'
import { RecoverySemanticWatchParser } from '../control/watch/semantic/RecoverySemanticWatchParser.js'
import { RecoverySemanticWatchService } from '../control/watch/semantic/RecoverySemanticWatchService.js'
import { StrandsRecoverySemanticWatchCompiler } from '../control/watch/semantic/StrandsRecoverySemanticWatchCompiler.js'
import { RecoveryDemoHandler } from '../demo/RecoveryDemoHandler.js'
import { RecoveryMcpToolRouter } from '../mcp/RecoveryMcpToolRouter.js'
import { RecoveryMcpServer } from '../mcp/RecoveryMcpServer.js'
import { NodeCertificateProbe } from '../node/certificate/NodeCertificateProbe.js'
import { LinuxNodeResourceProbe } from '../node/health/LinuxNodeResourceProbe.js'
import { NodeAgentHttpServer } from '../node/http/NodeAgentHttpServer.js'
import { SystemdNodeServiceRuntime } from '../node/systemd/SystemdNodeServiceRuntime.js'
import { RecoveryAgentCliHandler } from './RecoveryAgentCliHandler.js'
import { RecoveryMcpShutdownHandler } from './RecoveryMcpShutdownHandler.js'

function resolveRequest(arguments_: string[]): string {
  const argumentRequest = arguments_.join(' ').trim()
  if (argumentRequest.length > 0) return argumentRequest
  if (process.stdin.isTTY === true) return ''
  return readFileSync(0, 'utf8').trim()
}

function requireArgument(args: readonly string[], index: number, label: string): string {
  const value = args[index]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${label} is required`)
  return value
}

function requireApprovalToken(): string {
  const token = process.env['RECOVERY_APPROVAL_TOKEN']?.trim()
  if (token === undefined || token.length < 16) throw new Error('RECOVERY_APPROVAL_TOKEN must contain at least 16 characters')
  const actor = optionalEnvironment('RECOVERY_APPROVAL_ACTOR')
  if (actor === undefined) return token
  if (!/^[A-Za-z0-9._-]+$/.test(actor)) throw new Error('RECOVERY_APPROVAL_ACTOR may contain only letters, numbers, dot, underscore, and hyphen')
  return `${actor}:${token}`
}

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value === undefined || value.length === 0 ? undefined : value
}

function resolveStateAuthorityCommand(): string | undefined {
  const explicit = optionalEnvironment('RECOVERY_STATE_AUTHORITY_COMMAND')
  if (explicit !== undefined) return explicit
  if (optionalEnvironment('RECOVERY_STATE_JDBC_URL') === undefined) return undefined
  if (process.platform === 'win32') throw new Error('Bundled Recovery state authority launch is currently supported on Linux/macOS control hosts; configure RECOVERY_STATE_AUTHORITY_COMMAND explicitly for another platform')
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const bundled = resolve(moduleDirectory, '../../state-authority-runtime/bin/recovery-state-authority')
  if (!existsSync(bundled)) throw new Error('Durable Recovery state was requested through RECOVERY_STATE_JDBC_URL, but the bundled state authority launcher is missing; install a packaged Recovery Agent build or set RECOVERY_STATE_AUTHORITY_COMMAND explicitly')
  return bundled
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === 'demo') {
    process.stdout.write(`${JSON.stringify(await new RecoveryDemoHandler().run(), null, 2)}\n`)
    return
  }

  if (command === 'approve' || command === 'reject') {
    const planId = requireArgument(args, 1, 'recovery plan ID')
    const client = new RecoveryApprovalSocketClient(new RecoveryApprovalSocketPathResolver().resolve(process.env), requireApprovalToken())
    const result = command === 'approve' ? await client.approve(planId) : await client.reject(planId, args.slice(2).join(' '))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  if (command === 'node') {
    const config = new RecoveryNodeConfigReader().read(requireArgument(args, 1, 'node config path'))
    const token = process.env[config.tokenEnvironmentVariable]?.trim()
    if (token === undefined || token.length < 16) throw new Error(`Environment variable ${config.tokenEnvironmentVariable} must contain a node token of at least 16 characters`)
    const server = new NodeAgentHttpServer(
      new SystemdNodeServiceRuntime(config.nodeId, config.services),
      token,
      new LinuxNodeResourceProbe(),
      new NodeCertificateProbe(config.nodeId, config.certificates),
    )
    const address = await server.listen(config.listenPort, config.listenHost)
    process.stderr.write(`Recovery node ${config.nodeId} listening on ${address.baseUrl}\n`)
    await new Promise<void>((resolvePromise) => {
      const stop = (): void => { void server.close().finally(resolvePromise) }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    return
  }

  if (command === 'mcp') {
    const config = new RecoveryControlConfigReader().read(requireArgument(args, 1, 'control config path'))
    const bootstrap = new StrandsAgentRuntimeBootstrap()
    const durabilityBarrier = new RecoveryDurabilityCheckpointBarrier()
    const control = new RecoveryControlRuntimeBuilder(bootstrap, process.env, durabilityBarrier).build(config)
    const semanticTargets = config.nodes.flatMap((node) => node.services.map((service) => ({ nodeId: node.id, serviceId: service.id })))
    const serviceWatches = new RecoveryWatchService(control, new RecoveryWatchDefinitionBuilder().build(config))
    const nodeWatches = new RecoveryNodeWatchService(control, new RecoveryNodeWatchDefinitionBuilder().build(config))
    const readinessWatch = new RecoveryReadinessWatchService(control)
    const certificateWatch = new RecoveryCertificateWatchService(control, config.nodes.map((node) => node.id))
    const deploymentWatch = new RecoveryDeploymentWatchService(control, undefined, undefined, undefined, semanticTargets)
    const watches = new RecoveryWatchCoordinator(serviceWatches, nodeWatches, 1_000, readinessWatch, certificateWatch, deploymentWatch, durabilityBarrier)

    const semanticParser = new RecoverySemanticWatchParser(semanticTargets)
    const semanticCompiler = new StrandsRecoverySemanticWatchCompiler(bootstrap, new RecoveryAgentRuntimeConfigBuilder(process.env), semanticTargets, semanticParser)
    const semanticWatches = new RecoverySemanticWatchService(semanticCompiler, serviceWatches, semanticTargets)
    const retention = config.durableRetention === undefined ? undefined : new RecoveryDurableRetentionService(config.durableRetention)

    let durability: RecoveryDurableStateCoordinator | undefined
    const authorityCommand = resolveStateAuthorityCommand()
    if (authorityCommand !== undefined) {
      const authority = await RecoveryStateAuthorityProcessClient.start({ command: authorityCommand })
      durability = new RecoveryDurableStateCoordinator(authority, control, semanticWatches, Date.now, watches, retention)
      try {
        const loaded = await durability.hydrate()
        durabilityBarrier.bind(durability)
        await durabilityBarrier.checkpoint({
          actor: 'recovery-agent',
          action: 'control_start',
          summary: `Hydrated durable recovery state at revision ${loaded.revision} before exposing MCP, watches, or approval`,
        })
        process.stderr.write(`Recovery durable state authority hydrated revision ${loaded.revision}\n`)
      } catch (error: unknown) {
        const failures: unknown[] = [error]
        try { await durability.close() } catch (closeError: unknown) { failures.push(closeError) }
        try { await control.close() } catch (closeError: unknown) { failures.push(closeError) }
        if (failures.length > 1) throw new AggregateError(failures, 'Recovery durable startup failed and cleanup also failed', { cause: error })
        throw error
      }
    }

    const mcpServer = new RecoveryMcpServer(new RecoveryMcpToolRouter(control, watches, semanticWatches, durabilityBarrier))
    const approvalToken = process.env['RECOVERY_APPROVAL_TOKEN']?.trim()
    const hasNamedApprovalPrincipals = config.approvalPrincipals.length > 0
    const approvalServer = !hasNamedApprovalPrincipals && (approvalToken === undefined || approvalToken.length === 0)
      ? undefined
      : new RecoveryApprovalSocketServer(control, new RecoveryApprovalSocketPathResolver().resolve(process.env))
    if (approvalServer !== undefined) {
      await approvalServer.listen()
      process.stderr.write(`Recovery approval socket listening at ${new RecoveryApprovalSocketPathResolver().resolve(process.env)}\n`)
    }

    watches.start()
    mcpServer.serve()
    await new Promise<void>((resolvePromise, reject) => {
      let closing = false
      const stop = (): void => {
        if (closing) return
        closing = true
        const targets = {
          mcpServer,
          watches,
          control,
          ...(approvalServer === undefined ? {} : { approvalServer }),
          ...(durability === undefined ? {} : { durability }),
        }
        void new RecoveryMcpShutdownHandler().close(targets).then(resolvePromise, reject)
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      process.stdin.once('end', stop)
    })
    return
  }

  const bootstrap = new StrandsAgentRuntimeBootstrap()
  const result = await new RecoveryAgentCliHandler(bootstrap, new RecoveryAgentRuntimeConfigBuilder(process.env)).handle(resolveRequest(args))
  process.stdout.write(`${result}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
