export interface HttpServiceHealthCheckDefinition {
  readonly type: 'http'
  readonly url: string
  readonly timeoutMs: number
  readonly expectedStatusCodes: readonly number[]
}

export interface TcpServiceHealthCheckDefinition {
  readonly type: 'tcp'
  readonly host: string
  readonly port: number
  readonly timeoutMs: number
}

export type ServiceHealthCheckDefinition = HttpServiceHealthCheckDefinition | TcpServiceHealthCheckDefinition

export interface ServiceHealthCheckResult {
  readonly type: ServiceHealthCheckDefinition['type']
  readonly target: string
  readonly healthy: boolean
  readonly detail: string
  readonly observedAt: string
  readonly latencyMs: number
  readonly statusCode?: number
}

export interface IServiceHealthProbe {
  check(definition: ServiceHealthCheckDefinition): Promise<ServiceHealthCheckResult>
}
