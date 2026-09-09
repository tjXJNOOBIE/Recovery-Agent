import type { IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/strands-bridge'

import type { RecoveryAgentRuntimeConfigBuilder } from '../../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { IRecoveryPlanner, RecoveryPlanningRequest } from './IRecoveryPlanner.js'
import type { RecoveryPlanProposal } from './RecoveryPlan.js'
import type { RecoveryPlanProposalParser } from './RecoveryPlanProposalParser.js'

export class StrandsRecoveryPlanner implements IRecoveryPlanner {
  private readonly bootstrap: IStrandsAgentRuntimeBootstrap
  private readonly configBuilder: RecoveryAgentRuntimeConfigBuilder
  private readonly parser: RecoveryPlanProposalParser

  public constructor(
    bootstrap: IStrandsAgentRuntimeBootstrap,
    configBuilder: RecoveryAgentRuntimeConfigBuilder,
    parser: RecoveryPlanProposalParser,
  ) {
    this.bootstrap = bootstrap
    this.configBuilder = configBuilder
    this.parser = parser
  }

  public async plan(request: RecoveryPlanningRequest): Promise<RecoveryPlanProposal> {
    const runtime = await this.bootstrap.createAgentRuntime(this.configBuilder.build())
    try {
      const result = await runtime.invokeAgent(
        'Propose one bounded recovery plan for this incident. Return ONLY strict JSON with exactly '
        + '{"action":"restart_service"|"none","rationale":"..."}. '
        + 'The target is fixed by the incident and cannot be changed. Do not include node IDs, service IDs, shell commands, '
        + 'arguments, credentials, or additional fields. Use restart_service only when one additional human-approved restart '
        + `is evidence-supported; otherwise use none. Evidence: ${JSON.stringify(request)}`,
      )
      return this.parser.parse(result.toString())
    } finally {
      await runtime.close()
    }
  }
}
