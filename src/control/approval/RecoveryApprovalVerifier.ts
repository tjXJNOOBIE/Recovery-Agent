import { timingSafeEqual } from 'node:crypto'

export class RecoveryApprovalVerifier {
  private readonly secret: string | undefined

  public constructor(secret: string | undefined) {
    const normalized = secret?.trim()
    if (normalized !== undefined && normalized.length > 0 && normalized.length < 16) {
      throw new Error('RECOVERY_APPROVAL_TOKEN must contain at least 16 characters when configured')
    }
    this.secret = normalized === undefined || normalized.length === 0 ? undefined : normalized
  }

  public verify(token: string): void {
    if (this.secret === undefined) {
      throw new Error('Recovery plan approval is disabled until RECOVERY_APPROVAL_TOKEN is configured')
    }

    const normalized = token.trim()
    const expected = Buffer.from(this.secret)
    const actual = Buffer.from(normalized)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('Recovery plan approval token is invalid')
    }
  }
}
