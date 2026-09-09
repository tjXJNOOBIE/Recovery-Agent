export interface CertificateSnapshot {
  readonly nodeId: string
  readonly certificateId: string
  readonly target: string
  readonly observedAt: string
  readonly reachable: boolean
  readonly authorized: boolean
  readonly warnBeforeDays: number
  readonly criticalBeforeDays: number
  readonly daysRemaining?: number
  readonly validFrom?: string
  readonly validTo?: string
  readonly subject?: string
  readonly issuer?: string
  readonly fingerprint256?: string
  readonly authorizationError?: string
  readonly error?: string
}
