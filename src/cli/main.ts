#!/usr/bin/env node

import { readFileSync } from 'node:fs'

import { StrandsAgentRuntimeBootstrap } from '@tjxjnoobie/custom-strands-bridge'

import { RecoveryAgentRuntimeConfigBuilder } from '../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryAgentCliHandler } from './RecoveryAgentCliHandler.js'

function resolveRequest(arguments_: string[]): string {
  const argumentRequest = arguments_.join(' ').trim()

  if (argumentRequest.length > 0) {
    return argumentRequest
  }

  if (process.stdin.isTTY === true) {
    return ''
  }

  return readFileSync(0, 'utf8').trim()
}

async function main(): Promise<void> {
  const runtimeConfigBuilder = new RecoveryAgentRuntimeConfigBuilder(process.env)
  const agentRuntimeBootstrap = new StrandsAgentRuntimeBootstrap()
  const cliHandler = new RecoveryAgentCliHandler(
    agentRuntimeBootstrap,
    runtimeConfigBuilder,
  )
  const result = await cliHandler.handle(resolveRequest(process.argv.slice(2)))

  process.stdout.write(`${result}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
