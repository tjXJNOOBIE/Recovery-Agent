import type { RecoveryRunResult } from './RecoveryRunResult.js'

interface RecoveryCoalescedOperationState {
  readonly kind: 'recovery'
  readonly nodeId: string
  readonly serviceId: string
  readonly promise: Promise<RecoveryRunResult>
}

interface RecoveryExclusiveOperationState {
  readonly kind: 'exclusive'
  readonly nodeId: string
  readonly serviceId: string
  readonly promise: Promise<unknown>
}

type RecoveryOperationState = RecoveryCoalescedOperationState | RecoveryExclusiveOperationState

export class RecoveryOperationGate {
  private operations: readonly RecoveryOperationState[] = []

  public run(
    nodeId: string,
    serviceId: string,
    operation: () => Promise<RecoveryRunResult>,
  ): Promise<RecoveryRunResult> {
    const existing = this.find(nodeId, serviceId)
    if (existing === undefined) {
      return this.startRecovery(nodeId, serviceId, operation)
    }
    if (existing.kind === 'recovery') {
      return existing.promise
    }
    return existing.promise.then(
      () => this.run(nodeId, serviceId, operation),
      () => this.run(nodeId, serviceId, operation),
    )
  }

  public runExclusive<T>(
    nodeId: string,
    serviceId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const existing = this.find(nodeId, serviceId)
    if (existing !== undefined) {
      return existing.promise.then(
        () => this.runExclusive(nodeId, serviceId, operation),
        () => this.runExclusive(nodeId, serviceId, operation),
      )
    }
    return this.startExclusive(nodeId, serviceId, operation)
  }

  private startRecovery(
    nodeId: string,
    serviceId: string,
    operation: () => Promise<RecoveryRunResult>,
  ): Promise<RecoveryRunResult> {
    const promise = operation()
    const state: RecoveryCoalescedOperationState = { kind: 'recovery', nodeId, serviceId, promise }
    this.add(state)
    return promise
  }

  private startExclusive<T>(nodeId: string, serviceId: string, operation: () => Promise<T>): Promise<T> {
    const promise = operation()
    const state: RecoveryExclusiveOperationState = { kind: 'exclusive', nodeId, serviceId, promise }
    this.add(state)
    return promise
  }

  private add(state: RecoveryOperationState): void {
    this.operations = [...this.operations, state]
    void state.promise.then(
      () => this.remove(state),
      () => this.remove(state),
    )
  }

  private find(nodeId: string, serviceId: string): RecoveryOperationState | undefined {
    return this.operations.find(
      (candidate) => candidate.nodeId === nodeId && candidate.serviceId === serviceId,
    )
  }

  private remove(state: RecoveryOperationState): void {
    this.operations = this.operations.filter((candidate) => candidate !== state)
  }
}
