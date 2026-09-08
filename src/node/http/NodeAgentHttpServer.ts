import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

import type { INodeServiceRuntime } from '../runtime/INodeServiceRuntime.js'

export interface NodeAgentHttpServerAddress {
  readonly host: string
  readonly port: number
  readonly baseUrl: string
}

export class NodeAgentHttpServer {
  private readonly runtime: INodeServiceRuntime
  private readonly bearerToken: string
  private server: Server | undefined

  public constructor(runtime: INodeServiceRuntime, bearerToken: string) {
    const normalizedToken = bearerToken.trim()
    if (normalizedToken.length < 16) {
      throw new Error('Node bearer token must contain at least 16 non-blank characters')
    }
    this.runtime = runtime
    this.bearerToken = normalizedToken
  }

  public async listen(port = 0, host = '127.0.0.1'): Promise<NodeAgentHttpServerAddress> {
    if (this.server !== undefined) {
      throw new Error('Node agent HTTP server is already listening')
    }

    const server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })
    this.server = server

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        resolve()
      })
    })

    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Node agent HTTP server did not expose a TCP address')
    }

    return {
      host,
      port: address.port,
      baseUrl: `http://${host}:${address.port}`,
    }
  }

  public async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server === undefined) {
      return
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error))
    })
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.isAuthorized(request.headers.authorization)) {
        this.writeJson(response, 401, { error: 'unauthorized' })
        return
      }

      const url = new URL(request.url ?? '/', 'http://node-agent.local')
      const pathSegments = url.pathname.split('/').filter((segment) => segment.length > 0)

      if (request.method === 'GET' && url.pathname === '/v1/node') {
        const services = await this.runtime.listServices()
        this.writeJson(response, 200, {
          nodeId: this.runtime.nodeId,
          observedAt: new Date().toISOString(),
          services,
        })
        return
      }

      if (pathSegments.length === 3 && pathSegments[0] === 'v1' && pathSegments[1] === 'services') {
        const serviceId = decodeURIComponent(pathSegments[2] ?? '')
        if (request.method === 'GET') {
          this.writeJson(response, 200, await this.runtime.inspectService(serviceId))
          return
        }
      }

      if (
        pathSegments.length === 4
        && pathSegments[0] === 'v1'
        && pathSegments[1] === 'services'
        && pathSegments[3] === 'restart'
        && request.method === 'POST'
      ) {
        const serviceId = decodeURIComponent(pathSegments[2] ?? '')
        this.writeJson(response, 200, await this.runtime.restartService(serviceId))
        return
      }

      this.writeJson(response, 404, { error: 'not_found' })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.writeJson(response, 500, { error: 'node_operation_failed', message })
    }
  }

  private isAuthorized(authorization: string | undefined): boolean {
    if (authorization === undefined || !authorization.startsWith('Bearer ')) {
      return false
    }
    const received = Buffer.from(authorization.slice('Bearer '.length))
    const expected = Buffer.from(this.bearerToken)
    return received.length === expected.length && timingSafeEqual(received, expected)
  }

  private writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
    const body = JSON.stringify(value)
    response.statusCode = statusCode
    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.setHeader('content-length', Buffer.byteLength(body))
    response.end(body)
  }
}
