export function normalizeRecoveryCertificateFingerprint(value: string): string {
  const normalized = value.trim().replaceAll(':', '').toLowerCase()
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error('Recovery TLS certificate fingerprint must be a SHA-256 fingerprint')
  }
  return normalized
}

export class RecoveryCertificateFingerprintPolicy {
  private readonly allowed: ReadonlySet<string>

  public constructor(fingerprints: readonly string[]) {
    if (fingerprints.length === 0) throw new Error('Recovery TLS certificate fingerprint allowlist must not be empty')
    const normalized = fingerprints.map(normalizeRecoveryCertificateFingerprint)
    if (new Set(normalized).size !== normalized.length) throw new Error('Recovery TLS certificate fingerprint allowlist must not contain duplicates')
    this.allowed = new Set(normalized)
  }

  public accepts(fingerprint: string): boolean {
    return this.allowed.has(normalizeRecoveryCertificateFingerprint(fingerprint))
  }

  public requireAllowed(fingerprint: string, identityLabel: string): string {
    const normalized = normalizeRecoveryCertificateFingerprint(fingerprint)
    if (!this.allowed.has(normalized)) throw new Error(`${identityLabel} certificate fingerprint is not allowed`)
    return normalized
  }

  public list(): readonly string[] {
    return [...this.allowed]
  }
}
