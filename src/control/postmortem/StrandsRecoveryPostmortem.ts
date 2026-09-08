import type { IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/custom-strands-bridge'

import type { RecoveryAgentRuntimeConfigBuilder } from '../../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { IRecoveryPostmortemGenerator, RecoveryPostmortem, RecoveryPostmortemRequest } from './RecoveryPostmortem.js'
import type { RecoveryPostmortemParser } from './RecoveryPostmortemParser.js'

export class StrandsRecoveryPostmortem implements IRecoveryPostmortemGenerator {
  private readonly bootstrap: IStrandsAgentRuntimeBootstrap
  private readonly configBuilder: RecoveryAgentRuntimeConfigBuilder
  private readonly parser: RecoveryPostmortemParser

  public constructor(bootstrap: IStrandsAgentRuntimeBootstrap, configBuilder: RecoveryAgentRuntimeConfigBuilder, parser: RecoveryPostmortemParser) {
    this.bootstrap = bootstrap; this.configBuilder = configBuilder; this.parser = parser
  }

  public async generate(request: RecoveryPostmortemRequest): Promise<RecoveryPostmortem> {
    if (request.incident.status !== 'resolved') throw new Error('Recovery postmortem requires a resolved incident')
    const runtime = await this.bootstrap.createAgentRuntime(this.configBuilder.build())
    try {
      const result = await runtime.invokeAgent(
        'Generate an evidence-bound postmortem for this resolved recovery incident. Return ONLY strict JSON with exactly '
        + '{"summary":"...","rootCause":"...","contributingFactors":["..."],"recovery":"...","prevention":["..."],"confidence":"low"|"medium"|"high"}. '
        + 'Use rootCause="unknown" when the evidence does not establish causality. Do not invent actions, deployments, people, or outcomes not present in evidence. '
        + `Evidence: ${JSON.stringify(request)}`,
      )
      return this.parser.parse(request.incident.id, result.toString())
    } finally {
      await runtime.close()
    }
  }
}
