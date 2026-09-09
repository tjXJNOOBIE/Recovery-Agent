import { connect, type TLSSocket } from 'node:tls'

import type { INodeCertificateProbe } from '../certificate/NodeCertificateProbe.js'
import type { INodeResourceProbe } from '../health/INodeResourceProbe.js'
import type { INodeServiceRuntime } from '../runtime/INodeServiceRuntime.js'
import { RecoveryCertificateFingerprintPolicy } from './RecoveryCertificateFingerprintPolicy.js'
import { RecoveryNodeLineFramer } from './RecoveryNodeLineFramer.js'
import { RECOVERY_NODE_PROTOCOL_VERSION, type RecoveryNodeProtocolRequest } from './RecoveryNodeProtocol.js'
import { RecoveryNodeProtocolParser } from './RecoveryNodeProtocolParser.js'
import { RecoveryNodeRequestDispatcher } from './RecoveryNodeRequestDispatcher.js'

export interface RecoveryNodeOutboundTlsSessionOptions {
  readonly nodeId: string
  readonly host: string
  readonly port: number
  readonly serverName: string
  readonly certificate: string | Buffer
  readonly privateKey: string | Buffer
  readonly controlCertificateAuthority: string | Buffer | readonly (string | Buffer)[]
  readonly allowedControlCertificateFingerprints: readonly string[]
  readonly enrollmentTimeoutMs?: number
}

export class RecoveryNodeOutboundTlsSession {
  private readonly options: RecoveryNodeOutboundTlsSessionOptions
  private readonly dispatcher: RecoveryNodeRequestDispatcher
  private readonly controlFingerprintPolicy: RecoveryCertificateFingerprintPolicy
  private readonly parser = new RecoveryNodeProtocolParser()
  private socket: TLSSocket | undefined
  private connected = false

  public constructor(options: RecoveryNodeOutboundTlsSessionOptions, runtime: INodeServiceRuntime, resourceProbe?: INodeResourceProbe, certificateProbe?: INodeCertificateProbe) {
    const nodeId = options.nodeId.trim()
    const host = options.host.trim()
    const serverName = options.serverName.trim()
    if (nodeId.length === 0) throw new Error('Recovery outbound TLS nodeId must be non-blank')
    if (host.length === 0) throw new Error('Recovery outbound TLS host must be non-blank')
    if (serverName.length === 0) throw new Error('Recovery outbound TLS serverName must be non-blank')
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) throw new Error('Recovery outbound TLS port must be from 1 through 65535')
    const enrollmentTimeoutMs = options.enrollmentTimeoutMs ?? 5_000
    if (!Number.isSafeInteger(enrollmentTimeoutMs) || enrollmentTimeoutMs <= 0) throw new Error('Recovery outbound TLS enrollment timeout must be a positive safe integer')
    this.options = { ...options, nodeId, host, serverName, enrollmentTimeoutMs }
    this.dispatcher = new RecoveryNodeRequestDispatcher(runtime, resourceProbe, certificateProbe)
    this.controlFingerprintPolicy = new RecoveryCertificateFingerprintPolicy(options.allowedControlCertificateFingerprints)
  }

  public isConnected(): boolean {
    return this.connected && this.socket !== undefined && !this.socket.destroyed
  }

  public connect(): Promise<void> {
    if (this.socket !== undefined) return Promise.reject(new Error(`Recovery node ${this.options.nodeId} outbound TLS session is already started`))

    return new Promise<void>((resolve, reject) => {
      const framer = new RecoveryNodeLineFramer()
      let settled = false
      const authority = this.options.controlCertificateAuthority
      const controlCa: string | Buffer | (string | Buffer)[] = typeof authority === 'string' || Buffer.isBuffer(authority)
        ? authority
        : [...authority]
      const socket = connect({
        host: this.options.host,
        port: this.options.port,
        servername: this.options.serverName,
        cert: this.options.certificate,
        key: this.options.privateKey,
        ca: controlCa,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
      })
      this.socket = socket
      const failBeforeEnrollment = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.connected = false
        if (this.socket === socket) this.socket = undefined
        if (!socket.destroyed) socket.destroy()
        reject(error)
      }
      const timeout = setTimeout(() => failBeforeEnrollment(new Error(`Recovery node ${this.options.nodeId} TLS enrollment timed out`)), this.options.enrollmentTimeoutMs ?? 5_000)
      timeout.unref()

      socket.once('secureConnect', () => {
        try {
          if (!socket.authorized) throw new Error(`Recovery control TLS certificate unauthorized: ${String(socket.authorizationError ?? 'unknown authorization error')}`)
          const fingerprint = socket.getPeerCertificate().fingerprint256
          if (typeof fingerprint !== 'string' || fingerprint.length === 0) throw new Error('Recovery control TLS certificate has no SHA-256 fingerprint')
          this.controlFingerprintPolicy.requireAllowed(fingerprint, 'Recovery control host')
          socket.write(`${JSON.stringify({ version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'hello', nodeId: this.options.nodeId })}\n`)
        } catch (error: unknown) {
          failBeforeEnrollment(error instanceof Error ? error : new Error(String(error)))
        }
      })

      socket.on('data', (chunk: Buffer) => {
        try {
          for (const line of framer.push(chunk)) {
            const message = this.parser.parse(line)
            if (!this.connected) {
              if (message.type !== 'hello_ack' || message.nodeId !== this.options.nodeId) throw new Error(`Recovery node ${this.options.nodeId} received invalid enrollment acknowledgement`)
              settled = true
              clearTimeout(timeout)
              this.connected = true
              resolve()
              continue
            }
            if (message.type !== 'request') throw new Error(`Recovery node ${this.options.nodeId} received unexpected ${message.type} after enrollment`)
            void this.dispatchAndRespond(socket, message)
          }
        } catch (error: unknown) {
          const failure = error instanceof Error ? error : new Error(String(error))
          if (!this.connected) failBeforeEnrollment(failure)
          else this.failActiveSession(socket)
        }
      })

      socket.once('close', () => {
        if (!this.connected) failBeforeEnrollment(new Error(`Recovery node ${this.options.nodeId} TLS session closed before enrollment acknowledgement`))
        else this.failActiveSession(socket)
      })
      socket.on('error', (error) => {
        if (!this.connected) failBeforeEnrollment(error)
      })
    })
  }

  public async close(): Promise<void> {
    const socket = this.socket
    this.socket = undefined
    this.connected = false
    if (socket === undefined || socket.destroyed) return
    socket.destroy()
  }

  private async dispatchAndRespond(socket: TLSSocket, request: RecoveryNodeProtocolRequest): Promise<void> {
    const response = await this.dispatcher.dispatch(request)
    if (this.socket !== socket || socket.destroyed) return
    socket.write(`${JSON.stringify(response)}\n`)
  }

  private failActiveSession(socket: TLSSocket): void {
    if (this.socket !== socket) return
    this.socket = undefined
    this.connected = false
    if (!socket.destroyed) socket.destroy()
  }
}
