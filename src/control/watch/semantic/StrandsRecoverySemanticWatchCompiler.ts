import type { IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/strands-bridge'

import type { RecoveryAgentRuntimeConfigBuilder } from '../../../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { IRecoverySemanticWatchCompiler, RecoverySemanticWatchProposal, RecoverySemanticWatchTarget } from './RecoverySemanticWatch.js'
import type { RecoverySemanticWatchParser } from './RecoverySemanticWatchParser.js'

export class StrandsRecoverySemanticWatchCompiler implements IRecoverySemanticWatchCompiler {
  private readonly bootstrap: IStrandsAgentRuntimeBootstrap
  private readonly configBuilder: RecoveryAgentRuntimeConfigBuilder
  private readonly targets: readonly RecoverySemanticWatchTarget[]
  private readonly parser: RecoverySemanticWatchParser

  public constructor(
    bootstrap: IStrandsAgentRuntimeBootstrap,
    configBuilder: RecoveryAgentRuntimeConfigBuilder,
    targets: readonly RecoverySemanticWatchTarget[],
    parser: RecoverySemanticWatchParser,
  ) {
    this.bootstrap = bootstrap
    this.configBuilder = configBuilder
    this.targets = [...targets]
    this.parser = parser
  }

  public async compile(request: string): Promise<RecoverySemanticWatchProposal> {
    const normalized = request.trim()
    if (normalized.length === 0 || normalized.length > 4_000) throw new Error('Semantic recovery watch request must contain 1 through 4000 characters')
    const runtime = await this.bootstrap.createAgentRuntime(this.configBuilder.build())
    try {
      const result = await runtime.invokeAgent(
        'Compile the operator request into one deterministic service-recovery watch. Return ONLY strict JSON with exactly '
        + '{"nodeId":"...","serviceId":"...","intervalSeconds":123,"rationale":"..."}. '
        + 'Choose only a configured target and an interval from 10 through 86400 seconds. Do not create URLs, commands, new nodes/services, conditions, credentials, or recovery actions. '
        + `Configured targets: ${JSON.stringify(this.targets)} Operator request: ${JSON.stringify(normalized)}`,
      )
      return this.parser.parse(result.toString())
    } finally {
      await runtime.close()
    }
  }
}
