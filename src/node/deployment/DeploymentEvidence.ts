export interface DeploymentEvidence {
  readonly observedAt: string
  readonly available: boolean
  readonly marker?: string
  readonly deployedAt?: string
  readonly error?: string
}

export interface IDeploymentEvidenceProbe {
  inspect(markerFile: string): Promise<DeploymentEvidence>
}
