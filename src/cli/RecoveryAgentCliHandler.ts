import type { IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/custom-strands-bridge'

import type { RecoveryAgentRuntimeConfigBuilder } from '../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryAgentCliInputError } from './error/RecoveryAgentCliInputError.js'

export class RecoveryAgentCliHandler {
  private readonly agentRuntimeBootstrap: IStrandsAgentRuntimeBootstrap
  private readonly runtimeConfigBuilder: RecoveryAgentRuntimeConfigBuilder

  public constructor(
    agentRuntimeBootstrap: IStrandsAgentRuntimeBootstrap,
    runtimeConfigBuilder: RecoveryAgentRuntimeConfigBuilder,
  ) {
    this.agentRuntimeBootstrap = agentRuntimeBootstrap
    this.runtimeConfigBuilder = runtimeConfigBuilder
  }

  public async handle(request: string): Promise<string> {
    const normalizedRequest = request.trim()

    if (normalizedRequest.length === 0) {
      throw new RecoveryAgentCliInputError()
    }

    const agentRuntime = await this.agentRuntimeBootstrap.createAgentRuntime(
      this.runtimeConfigBuilder.build(),
    )

    try {
      const result = await agentRuntime.invokeAgent(normalizedRequest)

      return result.toString()
    } finally {
      await agentRuntime.close()
    }
  }
}
