import { chmodSync, lstatSync, unlinkSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import type { RecoveryControlRuntime } from '../../runtime/RecoveryControlRuntime.js'

export class RecoveryApprovalSocketServer {
  private readonly controlRuntime: RecoveryControlRuntime
  private readonly socketPath: string
  private server: Server | undefined

  public constructor(controlRuntime: RecoveryControlRuntime, socketPath: string) {
    const normalized = socketPath.trim()
    if (normalized.length === 0) throw new Error('Recovery approval socket path must be non-blank')
    this.controlRuntime = controlRuntime
    this.socketPath = normalized
  }

  public async listen(): Promise<void> {
    if (this.server !== undefined) throw new Error('Recovery approval socket server is already listening')
    this.removeOwnedStaleSocket()

    const server = createServer((request, response) => {
      void this.route(request, response)
    })
    this.server = server

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        this.server = undefined
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.socketPath)
    })

    chmodSync(this.socketPath, 0o600)
  }

  public async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error))
      })
    }
    this.removeOwnedStaleSocket()
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'POST') {
        this.json(response, 405, { error: 'method_not_allowed' })
        return
      }

      const match = /^\/v1\/plans\/([^/]+)\/(approve|reject)$/.exec(request.url ?? '')
      if (match === null) {
        this.json(response, 404, { error: 'not_found' })
        return
      }

      const planId = decodeURIComponent(match[1] ?? '')
      const action = match[2]
      const approvalToken = this.requireBearerToken(request)

      if (action === 'approve') {
        const result = await this.controlRuntime.approveRecoveryPlan(planId, approvalToken)
        this.json(response, 200, result)
        return
      }

      const body = await this.readJsonBody(request)
      const reason = body['reason']
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        throw new Error('Recovery plan rejection reason must be non-blank')
      }
      const result = this.controlRuntime.rejectRecoveryPlan(planId, approvalToken, reason)
      this.json(response, 200, result)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.json(response, 400, { error: message })
    }
  }

  private requireBearerToken(request: IncomingMessage): string {
    const authorization = request.headers.authorization
    if (authorization === undefined || !authorization.startsWith('Bearer ')) {
      throw new Error('Recovery approval Bearer token is required')
    }
    const token = authorization.slice('Bearer '.length).trim()
    if (token.length === 0) throw new Error('Recovery approval Bearer token is required')
    return token
  }

  private async readJsonBody(request: IncomingMessage): Promise<Readonly<Record<string, unknown>>> {
    let body = ''
    for await (const chunk of request) {
      body += String(chunk)
      if (body.length > 16_384) throw new Error('Recovery approval request body is too large')
    }
    if (body.trim().length === 0) return {}
    const parsed = JSON.parse(body) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Recovery approval request body must be a JSON object')
    }
    return parsed as Readonly<Record<string, unknown>>
  }

  private json(response: ServerResponse, statusCode: number, value: unknown): void {
    response.statusCode = statusCode
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(value))
  }

  private removeOwnedStaleSocket(): void {
    try {
      const stat = lstatSync(this.socketPath)
      if (!stat.isSocket()) throw new Error(`Refusing to remove non-socket approval path: ${this.socketPath}`)
      if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
        throw new Error(`Refusing to remove approval socket owned by another user: ${this.socketPath}`)
      }
      unlinkSync(this.socketPath)
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
      if (code !== 'ENOENT') throw error
    }
  }
}
