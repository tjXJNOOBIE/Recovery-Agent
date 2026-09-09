import { createConnection } from 'node:net'

import type {
  HttpServiceHealthCheckDefinition,
  IServiceHealthProbe,
  ServiceHealthCheckDefinition,
  ServiceHealthCheckResult,
  TcpServiceHealthCheckDefinition,
} from './ServiceHealthCheck.js'

export class NodeServiceHealthProbe implements IServiceHealthProbe {
  public check(definition: ServiceHealthCheckDefinition): Promise<ServiceHealthCheckResult> {
    return definition.type === 'http'
      ? this.checkHttp(definition)
      : this.checkTcp(definition)
  }

  private async checkHttp(definition: HttpServiceHealthCheckDefinition): Promise<ServiceHealthCheckResult> {
    const startedAt = Date.now()
    try {
      const response = await fetch(definition.url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(definition.timeoutMs),
      })
      await response.body?.cancel()
      const healthy = definition.expectedStatusCodes.includes(response.status)
      return {
        type: 'http',
        target: definition.url,
        healthy,
        detail: healthy
          ? `HTTP ${response.status}`
          : `HTTP ${response.status}; expected ${definition.expectedStatusCodes.join(',')}`,
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        statusCode: response.status,
      }
    } catch (error: unknown) {
      return {
        type: 'http',
        target: definition.url,
        healthy: false,
        detail: `HTTP probe failed: ${this.message(error)}`,
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      }
    }
  }

  private checkTcp(definition: TcpServiceHealthCheckDefinition): Promise<ServiceHealthCheckResult> {
    const startedAt = Date.now()
    return new Promise<ServiceHealthCheckResult>((resolve) => {
      let settled = false
      const socket = createConnection({ host: definition.host, port: definition.port })
      const complete = (healthy: boolean, detail: string): void => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve({
          type: 'tcp',
          target: `${definition.host}:${definition.port}`,
          healthy,
          detail,
          observedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
        })
      }

      socket.setTimeout(definition.timeoutMs)
      socket.once('connect', () => complete(true, 'TCP connection established'))
      socket.once('timeout', () => complete(false, `TCP probe timed out after ${definition.timeoutMs}ms`))
      socket.once('error', (error) => complete(false, `TCP probe failed: ${error.message}`))
    })
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
