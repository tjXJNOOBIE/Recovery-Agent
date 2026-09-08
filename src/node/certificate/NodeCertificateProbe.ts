import { connect, type TLSSocket } from 'node:tls'

import type { CertificateSnapshot } from './CertificateSnapshot.js'

export interface CertificateDefinition {
  readonly id: string
  readonly host: string
  readonly port: number
  readonly serverName: string
  readonly timeoutMs: number
  readonly warnBeforeDays: number
  readonly criticalBeforeDays: number
}

export interface INodeCertificateProbe {
  listCertificates(): Promise<readonly CertificateSnapshot[]>
}

export type RecoveryCertificateClock = () => number

export class NodeCertificateProbe implements INodeCertificateProbe {
  private readonly nodeId: string
  private readonly definitions: readonly CertificateDefinition[]
  private readonly clock: RecoveryCertificateClock

  public constructor(nodeId: string, definitions: readonly CertificateDefinition[], clock: RecoveryCertificateClock = Date.now) {
    this.nodeId = nodeId
    this.definitions = [...definitions]
    this.clock = clock
  }

  public listCertificates(): Promise<readonly CertificateSnapshot[]> {
    return Promise.all(this.definitions.map((definition) => this.inspect(definition)))
  }

  private inspect(definition: CertificateDefinition): Promise<CertificateSnapshot> {
    const observedAt = new Date(this.clock()).toISOString()
    return new Promise<CertificateSnapshot>((resolve) => {
      let settled = false
      const socket = connect({
        host: definition.host,
        port: definition.port,
        servername: definition.serverName,
        rejectUnauthorized: false,
      })
      const finish = (snapshot: CertificateSnapshot): void => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(snapshot)
      }
      const base = {
        nodeId: this.nodeId,
        certificateId: definition.id,
        target: `${definition.host}:${definition.port}`,
        observedAt,
        warnBeforeDays: definition.warnBeforeDays,
        criticalBeforeDays: definition.criticalBeforeDays,
      } as const

      socket.setTimeout(definition.timeoutMs)
      socket.once('secureConnect', () => finish(this.fromSocket(base, socket)))
      socket.once('timeout', () => finish({
        ...base,
        reachable: false,
        authorized: false,
        error: `TLS certificate probe timed out after ${definition.timeoutMs}ms`,
      }))
      socket.once('error', (error) => finish({
        ...base,
        reachable: false,
        authorized: false,
        error: `TLS certificate probe failed: ${error.message}`,
      }))
    })
  }

  private fromSocket(
    base: Pick<CertificateSnapshot, 'nodeId' | 'certificateId' | 'target' | 'observedAt' | 'warnBeforeDays' | 'criticalBeforeDays'>,
    socket: TLSSocket,
  ): CertificateSnapshot {
    const certificate = socket.getPeerCertificate()
    if (certificate.valid_to === undefined || certificate.valid_to.length === 0) {
      return {
        ...base,
        reachable: true,
        authorized: false,
        authorizationError: this.authorizationError(socket) ?? 'Peer did not provide a valid certificate',
      }
    }

    const validToMs = Date.parse(certificate.valid_to)
    const validFromMs = Date.parse(certificate.valid_from)
    const daysRemaining = Number.isFinite(validToMs)
      ? Math.round(((validToMs - this.clock()) / 86_400_000) * 100) / 100
      : undefined
    const subject = this.commonName(certificate.subject?.CN)
    const issuer = this.commonName(certificate.issuer?.CN)

    return {
      ...base,
      reachable: true,
      authorized: socket.authorized,
      ...(daysRemaining === undefined ? {} : { daysRemaining }),
      ...(Number.isFinite(validFromMs) ? { validFrom: new Date(validFromMs).toISOString() } : {}),
      ...(Number.isFinite(validToMs) ? { validTo: new Date(validToMs).toISOString() } : {}),
      ...(subject === undefined ? {} : { subject }),
      ...(issuer === undefined ? {} : { issuer }),
      ...(certificate.fingerprint256 === undefined ? {} : { fingerprint256: certificate.fingerprint256 }),
      ...(socket.authorized ? {} : { authorizationError: this.authorizationError(socket) ?? 'TLS certificate is not authorized' }),
    }
  }

  private commonName(value: string | readonly string[] | undefined): string | undefined {
    if (value === undefined) return undefined
    const normalized = (Array.isArray(value) ? value : [value])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .join(', ')
    return normalized.length === 0 ? undefined : normalized
  }

  private authorizationError(socket: TLSSocket): string | undefined {
    const error = socket.authorizationError
    if (error === undefined) return undefined
    return error instanceof Error ? error.message : String(error)
  }
}
