import type { IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/custom-strands-bridge'

import type { RecoveryAgentRuntimeConfigBuilder } from '../../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { IRecoveryInvestigator, RecoveryInvestigationRequest, RecoveryInvestigationResult } from './IRecoveryInvestigator.js'

export class StrandsRecoveryInvestigator implements IRecoveryInvestigator {
  private readonly bootstrap: IStrandsAgentRuntimeBootstrap
  private readonly configBuilder: RecoveryAgentRuntimeConfigBuilder

  public constructor(bootstrap: IStrandsAgentRuntimeBootstrap, configBuilder: RecoveryAgentRuntimeConfigBuilder) {
    this.bootstrap = bootstrap
    this.configBuilder = configBuilder
  }

  public async investigate(request: RecoveryInvestigationRequest): Promise<RecoveryInvestigationResult> {
    const runtime = await this.bootstrap.createAgentRuntime(this.configBuilder.build())
    try {
      const result = await runtime.invokeAgent(
        `Investigate this recovery incident and return a concise evidence-based diagnosis. `
        + `Do not claim any mutation. Evidence: ${JSON.stringify(request)}`,
      )
      return { summary: result.toString(), requiresHuman: true }
    } finally {
      await runtime.close()
    }
  }
}
