export interface RecoverySemanticWatchTarget {
  readonly nodeId: string
  readonly serviceId: string
}

export interface RecoverySemanticWatchProposal extends RecoverySemanticWatchTarget {
  readonly intervalSeconds: number
  readonly rationale: string
}

export interface RecoverySemanticWatchDefinition extends RecoverySemanticWatchTarget {
  readonly watchId: string
  readonly request: string
  readonly intervalMs: number
  readonly rationale: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface IRecoverySemanticWatchCompiler {
  compile(request: string): Promise<RecoverySemanticWatchProposal>
}
