import type { IRecoveryPlanner, RecoveryPlanningRequest } from '../../src/control/plan/IRecoveryPlanner.js'
import type { RecoveryPlanProposal } from '../../src/control/plan/RecoveryPlan.js'

export class FakeRecoveryPlanner implements IRecoveryPlanner {
  public calls = 0
  public readonly result: RecoveryPlanProposal
  public error: unknown | undefined

  public constructor(result: RecoveryPlanProposal = { action: 'none', rationale: 'No safe action proposed' }) {
    this.result = result
  }

  public async plan(_request: RecoveryPlanningRequest): Promise<RecoveryPlanProposal> {
    this.calls += 1
    if (this.error !== undefined) throw this.error
    return this.result
  }
}
