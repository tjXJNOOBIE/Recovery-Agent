import type { IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/custom-strands-bridge'

import type { RecoveryAgentRuntimeConfigBuilder } from '../../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { IRecoveryPlanCritic, RecoveryPlanReview } from './IRecoveryPlanCritic.js'
import type { RecoveryPlanningRequest } from './IRecoveryPlanner.js'
import type { RecoveryPlanProposal } from './RecoveryPlan.js'
import type { RecoveryPlanReviewParser } from './RecoveryPlanReviewParser.js'

export class StrandsRecoveryPlanCritic implements IRecoveryPlanCritic {
  private readonly bootstrap: IStrandsAgentRuntimeBootstrap
  private readonly configBuilder: RecoveryAgentRuntimeConfigBuilder
  private readonly parser: RecoveryPlanReviewParser

  public constructor(bootstrap: IStrandsAgentRuntimeBootstrap, configBuilder: RecoveryAgentRuntimeConfigBuilder, parser: RecoveryPlanReviewParser) {
    this.bootstrap = bootstrap; this.configBuilder = configBuilder; this.parser = parser
  }

  public async review(request: RecoveryPlanningRequest, proposal: RecoveryPlanProposal): Promise<RecoveryPlanReview> {
    const runtime = await this.bootstrap.createAgentRuntime(this.configBuilder.build())
    try {
      const result = await runtime.invokeAgent(
        'Review this already-bounded recovery proposal as a safety critic. You may only accept or reject it; do not invent another action. '
        + 'Return ONLY strict JSON with exactly {"accepted":true|false,"concerns":["..."]}. '
        + 'Reject when causality is weak, a dependency/deployment clue is unresolved, the action is unnecessary, sequencing is unsafe, or verification evidence is insufficient. '
        + `Proposal: ${JSON.stringify(proposal)} Evidence: ${JSON.stringify(request)}`,
      )
      return this.parser.parse(result.toString())
    } finally {
      await runtime.close()
    }
  }
}
