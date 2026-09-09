import { randomUUID } from 'node:crypto'
import type { TLSSocket } from 'node:tls'

import type { CertificateSnapshot } from '../certificate/CertificateSnapshot.js'
import type { ServiceActionResult } from '../data/ServiceActionResult.js'
import type { NodeSnapshot, ServiceSnapshot } from '../data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../gateway/INodeAgentGateway.js'
import { RecoveryNodeLineFramer } from './RecoveryNodeLineFramer.js'
import {
  RECOVERY_NODE_PROTOCOL_VERSION,
  type RecoveryNodeProtocolOperation,
  type RecoveryNodeProtocolRequest,
} from './RecoveryNodeProtocol.js'
import { RecoveryNodeProtocolParser } from './RecoveryNodeProtocolParser.js'

interface PendingNodeRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timeout: NodeJS.Timeout
}

export class RecoveryNodeSessionGateway implements INodeAgentGateway {
  public readonly nodeId: string
  private readonly requestTimeoutMs: number
  private readonly parser = new RecoveryNodeProtocolParser()
  private readonly pending = new Map<string, PendingNodeRequest>()
  private socket: TLSSocket | undefined

  public constructor(nodeId: string, requestTimeoutMs = 10_000) {
    const normalizedNodeId = nodeId.trim()
    if (normalizedNodeId.length === 0) throw new Error('Recovery node session gateway nodeId must be non-blank')
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error('Recovery node session request timeout must be a positive safe integer')
    this.nodeId = normalizedNodeId
    this.requestTimeoutMs = requestTimeoutMs
  }

  public isConnected(): boolean {
    return this.socket !== undefined && !this.socket.destroyed
  }

  public attach(socket: TLSSocket): void {
    if (this.isConnected()) throw new Error(`Recovery node ${this.nodeId} already has an active outbound session`)
    if (socket.destroyed) throw new Error(`Recovery node ${this.nodeId} cannot attach a destroyed TLS session`)

    const framer = new RecoveryNodeLineFramer()
    this.socket = socket
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const line of framer.push(chunk)) this.handleLine(socket, line)
      } catch (error: unknown) {
        this.failSession(socket, this.asError(error, `Recovery node ${this.nodeId} protocol failure`))
      }
    })
    socket.once('close', () => this.failSession(socket, new Error(`Recovery node ${this.nodeId} outbound session closed`)))
    socket.on('error', (error) => this.failSession(socket, error))
  }

  public inspectNode(): Promise<NodeSnapshot> {
    return this.request<NodeSnapshot>('inspect_node')
  }

  public inspectService(serviceId: string): Promise<ServiceSnapshot> {
    return this.request<ServiceSnapshot>('inspect_service', serviceId)
  }

  public inspectCertificates(): Promise<readonly CertificateSnapshot[]> {
    return this.request<readonly CertificateSnapshot[]>('inspect_certificates')
  }

  public restartService(serviceId: string): Promise<ServiceActionResult> {
    return this.request<ServiceActionResult>('restart_service', serviceId)
  }

  public async close(): Promise<void> {
    const socket = this.socket
    if (socket === undefined) return
    this.failSession(socket, new Error(`Recovery node ${this.nodeId} session gateway closed`))
    if (!socket.destroyed) socket.destroy()
  }

  private request<T>(operation: RecoveryNodeProtocolOperation, serviceId?: string): Promise<T> {
    const socket = this.socket
    if (socket === undefined || socket.destroyed) return Promise.reject(new Error(`Recovery node ${this.nodeId} outbound session is disconnected`))

    const id = randomUUID()
    const request: RecoveryNodeProtocolRequest = operation === 'inspect_node'
      ? { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'request', id, operation }
      : operation === 'inspect_certificates'
        ? { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'request', id, operation }
        : operation === 'inspect_service'
          ? { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'request', id, operation, serviceId: this.requireServiceId(serviceId) }
          : { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'request', id, operation, serviceId: this.requireServiceId(serviceId) }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Recovery node ${this.nodeId} request ${id} timed out after ${this.requestTimeoutMs}ms`))
      }, this.requestTimeoutMs)
      timeout.unref()
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      })
      socket.write(`${JSON.stringify(request)}\n`, (error?: Error | null) => {
        if (error === undefined || error === null) return
        const pending = this.pending.get(id)
        if (pending === undefined) return
        this.pending.delete(id)
        clearTimeout(pending.timeout)
        pending.reject(error)
      })
    })
  }

  private handleLine(socket: TLSSocket, line: string): void {
    const message = this.parser.parse(line)
    if (message.type !== 'response') {
      this.failSession(socket, new Error(`Recovery node ${this.nodeId} sent unexpected ${message.type} after session enrollment`))
      return
    }
    const pending = this.pending.get(message.id)
    if (pending === undefined) {
      this.failSession(socket, new Error(`Recovery node ${this.nodeId} sent response for unknown request ${message.id}`))
      return
    }
    this.pending.delete(message.id)
    clearTimeout(pending.timeout)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(`Recovery node ${this.nodeId} request failed [${message.error.code}]: ${message.error.message}`))
  }

  private failSession(socket: TLSSocket, error: Error): void {
    if (this.socket !== socket) return
    this.socket = undefined
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    if (!socket.destroyed) socket.destroy()
  }

  private requireServiceId(serviceId: string | undefined): string {
    if (serviceId === undefined || serviceId.trim().length === 0) throw new Error('Recovery node protocol serviceId must be non-blank')
    return serviceId
  }

  private asError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(`${fallback}: ${String(error)}`)
  }
}
