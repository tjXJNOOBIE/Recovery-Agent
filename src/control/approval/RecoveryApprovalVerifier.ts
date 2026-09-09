import { timingSafeEqual } from 'node:crypto'

import type { RecoveryApprovalPrincipalConfig } from '../../config/RecoveryControlConfig.js'

export interface RecoveryApprovalIdentity {
  readonly actor: string
  readonly mode: 'principal' | 'legacy_local'
}

export type RecoveryApprovalClock = () => number
export type RecoveryApprovalEnvironment = Readonly<Record<string, string | undefined>>

interface RecoveryApprovalPrincipalRuntime {
  readonly id: string
  readonly secret: string | undefined
  readonly revoked: boolean
  readonly expiresAtMs?: number
}

export class RecoveryApprovalVerifier {
  private readonly legacySecret: string | undefined
  private readonly principals: readonly RecoveryApprovalPrincipalRuntime[]
  private readonly clock: RecoveryApprovalClock

  public constructor(secret: string | undefined, principals: readonly RecoveryApprovalPrincipalRuntime[] = [], clock: RecoveryApprovalClock = Date.now) {
    const normalized = secret?.trim()
    if (normalized !== undefined && normalized.length > 0 && normalized.length < 16) throw new Error('RECOVERY_APPROVAL_TOKEN must contain at least 16 characters when configured')
    this.legacySecret = normalized === undefined || normalized.length === 0 ? undefined : normalized
    this.principals = principals.map((principal) => ({ ...principal }))
    this.clock = clock
  }

  public static fromConfig(configs: readonly RecoveryApprovalPrincipalConfig[], environment: RecoveryApprovalEnvironment, legacySecret: string | undefined, clock: RecoveryApprovalClock = Date.now): RecoveryApprovalVerifier {
    const nowMs = clock()
    if (!Number.isFinite(nowMs)) throw new Error('Recovery approval clock must return a finite timestamp')
    const activeSecrets = new Map<string, string>()
    const principals = configs.map((config) => {
      const expiresAtMs = config.expiresAt === undefined ? undefined : Date.parse(config.expiresAt)
      const alreadyExpired = expiresAtMs !== undefined && nowMs >= expiresAtMs
      const value = environment[config.tokenEnvironmentVariable]?.trim()
      if (!config.revoked && !alreadyExpired) {
        if (value === undefined || value.length < 16) {
          throw new Error(`Environment variable ${config.tokenEnvironmentVariable} must contain an approval token of at least 16 characters for principal ${config.id}`)
        }
        const existingPrincipalId = activeSecrets.get(value)
        if (existingPrincipalId !== undefined) {
          throw new Error(`Recovery approval principals ${existingPrincipalId} and ${config.id} must not share the same active secret`)
        }
        activeSecrets.set(value, config.id)
      }
      return {
        id: config.id,
        secret: value === undefined || value.length === 0 ? undefined : value,
        revoked: config.revoked,
        ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
      }
    })
    return new RecoveryApprovalVerifier(legacySecret, principals, clock)
  }

  public verify(credential: string): RecoveryApprovalIdentity {
    if (this.principals.length > 0) return this.verifyPrincipalCredential(credential)
    if (this.legacySecret === undefined) throw new Error('Recovery plan approval is disabled until an approval principal or RECOVERY_APPROVAL_TOKEN is configured')
    this.verifySecret(this.legacySecret, credential)
    return { actor: 'local-control-host', mode: 'legacy_local' }
  }

  private verifyPrincipalCredential(credential: string): RecoveryApprovalIdentity {
    const separator = credential.indexOf(':')
    if (separator <= 0 || separator === credential.length - 1) throw new Error('Recovery approval credential must be principal-id:secret when approval principals are configured')
    const actor = credential.slice(0, separator).trim()
    const presentedSecret = credential.slice(separator + 1).trim()
    const principal = this.principals.find((candidate) => candidate.id === actor)
    if (principal === undefined) throw new Error(`Unknown Recovery approval principal: ${actor}`)
    if (principal.revoked) throw new Error(`Recovery approval principal ${actor} is revoked`)
    if (principal.expiresAtMs !== undefined && this.now() >= principal.expiresAtMs) throw new Error(`Recovery approval principal ${actor} is expired`)
    if (principal.secret === undefined) throw new Error(`Recovery approval principal ${actor} has no active credential`)
    this.verifySecret(principal.secret, presentedSecret)
    return { actor, mode: 'principal' }
  }

  private verifySecret(expectedSecret: string, actualToken: string): void {
    const normalized = actualToken.trim()
    const expected = Buffer.from(expectedSecret)
    const actual = Buffer.from(normalized)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Recovery plan approval token is invalid')
  }

  private now(): number {
    const value = this.clock()
    if (!Number.isFinite(value)) throw new Error('Recovery approval clock must return a finite timestamp')
    return value
  }
}
