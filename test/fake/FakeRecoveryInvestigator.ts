import type { IRecoveryInvestigator, RecoveryInvestigationRequest, RecoveryInvestigationResult } from '../../src/control/investigation/IRecoveryInvestigator.js'

export class FakeRecoveryInvestigator implements IRecoveryInvestigator {
  public calls = 0
  public readonly result: RecoveryInvestigationResult

  public constructor(result: RecoveryInvestigationResult = { summary: 'fake investigation', requiresHuman: true }) {
    this.result = result
  }

  public async investigate(_request: RecoveryInvestigationRequest): Promise<RecoveryInvestigationResult> {
    this.calls += 1
    return this.result
  }
}
