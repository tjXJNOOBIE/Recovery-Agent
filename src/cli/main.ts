#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { StrandsAgentRuntimeBootstrap } from '@tjxjnoobie/custom-strands-bridge'

import { RecoveryAgentRuntimeConfigBuilder } from '../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryControlConfigReader } from '../config/RecoveryControlConfig.js'
import { RecoveryNodeConfigReader } from '../config/RecoveryNodeConfig.js'
import { RecoveryControlRuntimeBuilder } from '../control/runtime/RecoveryControlRuntimeBuilder.js'
import { RecoveryWatchDefinitionBuilder } from '../control/watch/RecoveryWatchDefinitionBuilder.js'
import { RecoveryWatchService } from '../control/watch/RecoveryWatchService.js'
import { RecoveryDemoHandler } from '../demo/RecoveryDemoHandler.js'
import { RecoveryMcpToolRouter } from '../mcp/RecoveryMcpToolRouter.js'
import { RecoveryMcpServer } from '../mcp/RecoveryMcpServer.js'
import { NodeAgentHttpServer } from '../node/http/NodeAgentHttpServer.js'
import { SystemdNodeServiceRuntime } from '../node/systemd/SystemdNodeServiceRuntime.js'
import { RecoveryAgentCliHandler } from './RecoveryAgentCliHandler.js'

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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === 'demo') {
    const result = await new RecoveryDemoHandler().run()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  if (command === 'node') {
    const configPath = requireArgument(args, 1, 'node config path')
    const config = new RecoveryNodeConfigReader().read(configPath)
    const token = process.env[config.tokenEnvironmentVariable]?.trim()
    if (token === undefined || token.length < 16) throw new Error(`Environment variable ${config.tokenEnvironmentVariable} must contain a node token of at least 16 characters`)
    const server = new NodeAgentHttpServer(new SystemdNodeServiceRuntime(config.nodeId, config.services), token)
    const address = await server.listen(config.listenPort, config.listenHost)
    process.stderr.write(`Recovery node ${config.nodeId} listening on ${address.baseUrl}\n`)
    await new Promise<void>((resolve) => {
      const stop = (): void => { void server.close().finally(resolve) }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    return
  }

  if (command === 'mcp') {
    const configPath = requireArgument(args, 1, 'control config path')
    const config = new RecoveryControlConfigReader().read(configPath)
    const bootstrap = new StrandsAgentRuntimeBootstrap()
    const control = new RecoveryControlRuntimeBuilder(bootstrap, process.env).build(config)
    const watchService = new RecoveryWatchService(control, new RecoveryWatchDefinitionBuilder().build(config))
    const mcpServer = new RecoveryMcpServer(new RecoveryMcpToolRouter(control, watchService))
    watchService.start()
    mcpServer.serve()

    await new Promise<void>((resolve, reject) => {
      let closing = false
      const stop = (): void => {
        if (closing) return
        closing = true
        void mcpServer.close()
          .then(() => watchService.close())
          .then(() => control.close())
          .then(resolve, reject)
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      process.stdin.once('end', stop)
    })
    return
  }

  const bootstrap = new StrandsAgentRuntimeBootstrap()
  const cliHandler = new RecoveryAgentCliHandler(bootstrap, new RecoveryAgentRuntimeConfigBuilder(process.env))
  const result = await cliHandler.handle(resolveRequest(args))
  process.stdout.write(`${result}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
