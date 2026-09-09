import type { INodeCertificateProbe } from '../certificate/NodeCertificateProbe.js'
import type { INodeResourceProbe } from '../health/INodeResourceProbe.js'
import type { INodeServiceRuntime } from '../runtime/INodeServiceRuntime.js'
import { RecoveryNodeOutboundTlsSession } from './RecoveryNodeOutboundTlsSession.js'
import { RecoveryTlsMaterialReader, type RecoveryTlsMaterial } from './RecoveryTlsMaterialReader.js'

export interface RecoveryNodeOutboundTlsLifecycleOptions {
  readonly nodeId: string
  readonly host: string
  readonly port: number
  readonly serverName: string
  readonly certificateFile: string
  readonly privateKeyFile: string
  readonly controlCertificateAuthorityFile: string
  readonly allowedControlCertificateFingerprints: readonly string[]
  readonly enrollmentTimeoutMs?: number
  readonly reconnectInitialDelayMs?: number
  readonly reconnectMaximumDelayMs?: number
  readonly onFailure?: (error: Error) => void
}

export interface RecoveryOutboundTlsSessionHandle {
  connect(): Promise<void>
  waitForDisconnect(): Promise<void>
  close(): Promise<void>
}

export type RecoveryOutboundTlsSessionFactory = (material: RecoveryTlsMaterial) => RecoveryOutboundTlsSessionHandle

export class RecoveryNodeOutboundTlsLifecycle {
  private readonly options: RecoveryNodeOutboundTlsLifecycleOptions
  private readonly materialReader: RecoveryTlsMaterialReader
  private readonly createSession: RecoveryOutboundTlsSessionFactory
  private readonly reconnectInitialDelayMs: number
  private readonly reconnectMaximumDelayMs: number
  private running: Promise<void> | undefined
  private session: RecoveryOutboundTlsSessionHandle | undefined
  private closing = false
  private releaseDelay: (() => void) | undefined

  public constructor(
    options: RecoveryNodeOutboundTlsLifecycleOptions,
    runtime: INodeServiceRuntime,
    resourceProbe?: INodeResourceProbe,
    certificateProbe?: INodeCertificateProbe,
    materialReader = new RecoveryTlsMaterialReader(),
    sessionFactory?: RecoveryOutboundTlsSessionFactory,
  ) {
    const reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 1_000
    const reconnectMaximumDelayMs = options.reconnectMaximumDelayMs ?? 30_000
    if (!Number.isSafeInteger(reconnectInitialDelayMs) || reconnectInitialDelayMs <= 0) throw new Error('Recovery reconnect initial delay must be a positive safe integer')
    if (!Number.isSafeInteger(reconnectMaximumDelayMs) || reconnectMaximumDelayMs < reconnectInitialDelayMs) throw new Error('Recovery reconnect maximum delay must be a safe integer greater than or equal to the initial delay')
    this.options = options
    this.materialReader = materialReader
    this.reconnectInitialDelayMs = reconnectInitialDelayMs
    this.reconnectMaximumDelayMs = reconnectMaximumDelayMs
    this.createSession = sessionFactory ?? ((material) => new RecoveryNodeOutboundTlsSession({
      nodeId: options.nodeId,
      host: options.host,
      port: options.port,
      serverName: options.serverName,
      certificate: material.certificate,
      privateKey: material.privateKey,
      controlCertificateAuthority: material.certificateAuthority,
      allowedControlCertificateFingerprints: options.allowedControlCertificateFingerprints,
      ...(options.enrollmentTimeoutMs === undefined ? {} : { enrollmentTimeoutMs: options.enrollmentTimeoutMs }),
    }, runtime, resourceProbe, certificateProbe))
  }

  public start(): void {
    if (this.running !== undefined) throw new Error(`Recovery node ${this.options.nodeId} outbound TLS lifecycle is already started`)
    this.closing = false
    this.running = this.run()
  }

  public async close(): Promise<void> {
    this.closing = true
    this.releaseDelay?.()
    const session = this.session
    if (session !== undefined) await session.close()
    await this.running
    this.running = undefined
    this.session = undefined
  }

  private async run(): Promise<void> {
    let reconnectDelayMs = this.reconnectInitialDelayMs
    while (!this.closing) {
      let session: RecoveryOutboundTlsSessionHandle | undefined
      try {
        const material = this.materialReader.read({
          certificateFile: this.options.certificateFile,
          privateKeyFile: this.options.privateKeyFile,
          certificateAuthorityFile: this.options.controlCertificateAuthorityFile,
        })
        session = this.createSession(material)
        this.session = session
        await session.connect()
        reconnectDelayMs = this.reconnectInitialDelayMs
        await session.waitForDisconnect()
      } catch (error: unknown) {
        this.options.onFailure?.(error instanceof Error ? error : new Error(String(error)))
      } finally {
        if (session !== undefined) {
          try {
            await session.close()
          } catch (error: unknown) {
            this.options.onFailure?.(error instanceof Error ? error : new Error(String(error)))
          }
        }
        if (this.session === session) this.session = undefined
      }

      if (this.closing) break
      await this.waitForReconnect(reconnectDelayMs)
      reconnectDelayMs = Math.min(this.reconnectMaximumDelayMs, reconnectDelayMs * 2)
    }
  }

  private waitForReconnect(delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (this.releaseDelay === finish) this.releaseDelay = undefined
        resolve()
      }
      const timeout = setTimeout(finish, delayMs)
      this.releaseDelay = finish
      if (this.closing) finish()
    })
  }
}
