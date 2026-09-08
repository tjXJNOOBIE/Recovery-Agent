import type {
  RecoveryDurableAuditRequest,
  RecoveryDurableCheckpointOverrides,
  RecoveryDurableStateCoordinator,
} from './RecoveryDurableStateCoordinator.js'

export interface IRecoveryDurabilityCheckpoint {
  assertMutationAllowed(): void
  checkpoint(request: RecoveryDurableAuditRequest, overrides?: RecoveryDurableCheckpointOverrides): Promise<void>
}

export interface IRecoveryDurabilityStateCheckpoint {
  checkpointState(overrides?: RecoveryDurableCheckpointOverrides): Promise<void>
}

export class RecoveryDurabilityCheckpointBarrier implements IRecoveryDurabilityCheckpoint, IRecoveryDurabilityStateCheckpoint {
  private coordinator: RecoveryDurableStateCoordinator | undefined
  private failure: Error | undefined

  public bind(coordinator: RecoveryDurableStateCoordinator): void {
    if (this.coordinator !== undefined) throw new Error('Recovery durability checkpoint barrier is already bound')
    if (this.failure !== undefined) throw this.failure
    this.coordinator = coordinator
  }

  public isBound(): boolean { return this.coordinator !== undefined }
  public assertMutationAllowed(): void { if (this.failure !== undefined) throw this.failure }

  public checkpoint(request: RecoveryDurableAuditRequest, overrides?: RecoveryDurableCheckpointOverrides): Promise<void> {
    return this.persist(request, overrides)
  }

  public checkpointState(overrides?: RecoveryDurableCheckpointOverrides): Promise<void> {
    return this.persist(undefined, overrides)
  }

  private async persist(request?: RecoveryDurableAuditRequest, overrides?: RecoveryDurableCheckpointOverrides): Promise<void> {
    this.assertMutationAllowed()
    if (this.coordinator === undefined) return
    try {
      await this.coordinator.checkpoint(request, overrides)
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : new Error(String(error))
      const failure = new Error(`Recovery durability checkpoint failed; further mutations are disabled: ${cause.message}`, { cause })
      this.failure = failure
      throw failure
    }
  }
}
