import { createServer, type Server as TlsServer, type TLSSocket } from 'node:tls'

import { RecoveryCertificateFingerprintPolicy } from './RecoveryCertificateFingerprintPolicy.js'
import { RecoveryNodeLineFramer } from './RecoveryNodeLineFramer.js'
import { RECOVERY_NODE_PROTOCOL_VERSION } from './RecoveryNodeProtocol.js'
import { RecoveryNodeProtocolParser } from './RecoveryNodeProtocolParser.js'
import { RecoveryNodeSessionGateway } from './RecoveryNodeSessionGateway.js'

export interface RecoveryControlTlsNodeIdentity {
  readonly nodeId: string
  readonly allowedCertificateFingerprints: readonly string[]
}

export interface RecoveryControlTlsSessionServerOptions {
  readonly certificate: string | Buffer
  readonly privateKey: string | Buffer
  readonly clientCertificateAuthority: string | Buffer | readonly (string | Buffer)[]
  readonly nodes: readonly RecoveryControlTlsNodeIdentity[]
  readonly requestTimeoutMs?: number
  readonly enrollmentTimeoutMs?: number
}

export interface RecoveryControlTlsSessionServerAddress {
  readonly host: string
  readonly port: number
}

interface NodeIdentityRuntime {
  readonly nodeId: string
  readonly fingerprintPolicy: RecoveryCertificateFingerprintPolicy
  readonly gateway: RecoveryNodeSessionGateway
}

export class RecoveryControlTlsSessionServer {
  private readonly options: RecoveryControlTlsSessionServerOptions
  private readonly identities: readonly NodeIdentityRuntime[]
  private readonly enrollmentTimeoutMs: number
  private readonly enrollingSockets: TLSSocket[] = []
  private server: TlsServer | undefined

  public constructor(options: RecoveryControlTlsSessionServerOptions) {
    if (options.nodes.length === 0) throw new Error('Recovery control TLS session server requires at least one configured node identity')
    const requestTimeoutMs = options.requestTimeoutMs ?? 10_000
    const enrollmentTimeoutMs = options.enrollmentTimeoutMs ?? 5_000
    if (!Number.isSafeInteger(enrollmentTimeoutMs) || enrollmentTimeoutMs <= 0) throw new Error('Recovery TLS enrollment timeout must be a positive safe integer')
    const nodeIds = new Set<string>()
    this.identities = options.nodes.map((node) => {
      const nodeId = node.nodeId.trim()
      if (nodeId.length === 0) throw new Error('Recovery TLS node identity nodeId must be non-blank')
      if (nodeIds.has(nodeId)) throw new Error(`Duplicate Recovery TLS node identity: ${nodeId}`)
      nodeIds.add(nodeId)
      return {
        nodeId,
        fingerprintPolicy: new RecoveryCertificateFingerprintPolicy(node.allowedCertificateFingerprints),
        gateway: new RecoveryNodeSessionGateway(nodeId, requestTimeoutMs),
      }
    })
    this.options = options
    this.enrollmentTimeoutMs = enrollmentTimeoutMs
  }

  public gateway(nodeId: string): RecoveryNodeSessionGateway {
    const identity = this.identities.find((candidate) => candidate.nodeId === nodeId)
    if (identity === undefined) throw new Error(`Unknown Recovery TLS node identity: ${nodeId}`)
    return identity.gateway
  }

  public async listen(port = 0, host = '127.0.0.1'): Promise<RecoveryControlTlsSessionServerAddress> {
    if (this.server !== undefined) throw new Error('Recovery control TLS session server is already listening')
    const clientCa = Array.isArray(this.options.clientCertificateAuthority)
      ? [...this.options.clientCertificateAuthority]
      : this.options.clientCertificateAuthority
    const server = createServer({
      cert: this.options.certificate,
      key: this.options.privateKey,
      ca: clientCa,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
    }, (socket) => this.enroll(socket))
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Recovery control TLS session server did not expose a TCP address')
    return { host, port: address.port }
  }

  public async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    for (const socket of [...this.enrollingSockets]) if (!socket.destroyed) socket.destroy()
    this.enrollingSockets.length = 0
    const failures: unknown[] = []
    for (const identity of this.identities) {
      try {
        await identity.gateway.close()
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (server !== undefined) {
      try {
        await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Failed to close Recovery control TLS session server')
  }

  private enroll(socket: TLSSocket): void {
    socket.on('error', () => {})
    if (!socket.authorized) {
      socket.destroy(new Error(`Recovery TLS client certificate unauthorized: ${String(socket.authorizationError ?? 'unknown authorization error')}`))
      return
    }
    this.enrollingSockets.push(socket)
    const framer = new RecoveryNodeLineFramer()
    const parser = new RecoveryNodeProtocolParser()
    const timeout = setTimeout(() => socket.destroy(new Error('Recovery node TLS enrollment timed out')), this.enrollmentTimeoutMs)
    timeout.unref()

    const cleanup = (): void => {
      clearTimeout(timeout)
      socket.off('data', onData)
      socket.off('close', cleanup)
      const index = this.enrollingSockets.indexOf(socket)
      if (index >= 0) this.enrollingSockets.splice(index, 1)
    }

    const onData = (chunk: Buffer): void => {
      try {
        const lines = framer.push(chunk)
        if (lines.length === 0) return
        if (lines.length !== 1) throw new Error('Recovery node enrollment must contain exactly one hello frame')
        framer.finish()
        const message = parser.parse(lines[0] ?? '')
        if (message.type !== 'hello') throw new Error('Recovery node TLS session must begin with hello')
        const identity = this.identities.find((candidate) => candidate.nodeId === message.nodeId)
        if (identity === undefined) throw new Error(`Recovery node TLS hello references unconfigured node ${message.nodeId}`)
        const fingerprint = socket.getPeerCertificate().fingerprint256
        if (typeof fingerprint !== 'string' || fingerprint.length === 0) throw new Error('Recovery node TLS peer certificate has no SHA-256 fingerprint')
        identity.fingerprintPolicy.requireAllowed(fingerprint, `Recovery node ${message.nodeId}`)
        cleanup()
        identity.gateway.attach(socket)
        socket.write(`${JSON.stringify({ version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'hello_ack', nodeId: message.nodeId })}\n`)
      } catch (error: unknown) {
        cleanup()
        socket.destroy(error instanceof Error ? error : new Error(String(error)))
      }
    }

    socket.on('data', onData)
    socket.once('close', cleanup)
  }
}
