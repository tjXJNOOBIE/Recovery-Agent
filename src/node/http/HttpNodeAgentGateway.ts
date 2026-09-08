import type { ServiceActionResult } from '../data/ServiceActionResult.js'
import type { NodeSnapshot, ServiceSnapshot } from '../data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../gateway/INodeAgentGateway.js'

export class HttpNodeAgentGateway implements INodeAgentGateway {
  public readonly nodeId: string
  private readonly baseUrl: string
  private readonly bearerToken: string

  public constructor(nodeId: string, baseUrl: string, bearerToken: string) {
    this.nodeId = nodeId
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.bearerToken = bearerToken
  }

  public inspectNode(): Promise<NodeSnapshot> {
    return this.request<NodeSnapshot>('GET', '/v1/node')
  }

  public inspectService(serviceId: string): Promise<ServiceSnapshot> {
    return this.request<ServiceSnapshot>('GET', `/v1/services/${encodeURIComponent(serviceId)}`)
  }

  public restartService(serviceId: string): Promise<ServiceActionResult> {
    return this.request<ServiceActionResult>('POST', `/v1/services/${encodeURIComponent(serviceId)}/restart`)
  }

  public async close(): Promise<void> {}

  private async request<T>(method: 'GET' | 'POST', path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    })
    const body: unknown = await response.json()
    if (!response.ok) {
      throw new Error(`Node ${this.nodeId} request failed (${response.status}): ${JSON.stringify(body)}`)
    }
    return body as T
  }
}
