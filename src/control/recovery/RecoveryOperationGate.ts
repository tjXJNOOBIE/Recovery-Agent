import type { RecoveryRunResult } from './RecoveryRunResult.js'

interface RecoveryOperationState {
  readonly nodeId: string
  readonly serviceId: string
  readonly promise: Promise<RecoveryRunResult>
}

export class RecoveryOperationGate {
  private operations: readonly RecoveryOperationState[] = []

  public run(
    nodeId: string,
    serviceId: string,
    operation: () => Promise<RecoveryRunResult>,
  ): Promise<RecoveryRunResult> {
    const existing = this.operations.find(
      (candidate) => candidate.nodeId === nodeId && candidate.serviceId === serviceId,
    )
    if (existing !== undefined) {
      return existing.promise
    }

    const promise = operation()
    const state: RecoveryOperationState = { nodeId, serviceId, promise }
    this.operations = [...this.operations, state]
    void promise.then(
      () => this.remove(state),
      () => this.remove(state),
    )
    return promise
  }

  private remove(state: RecoveryOperationState): void {
    this.operations = this.operations.filter((candidate) => candidate !== state)
  }
}
