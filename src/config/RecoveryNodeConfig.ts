import { readFileSync } from 'node:fs'

import type { ServiceHealthCheckDefinition } from '../node/health/ServiceHealthCheck.js'

export interface RecoveryNodeServiceConfig {
  readonly id: string
  readonly unit: string
  readonly healthChecks: readonly ServiceHealthCheckDefinition[]
}

export interface RecoveryNodeConfig {
  readonly nodeId: string
  readonly listenHost: string
  readonly listenPort: number
  readonly tokenEnvironmentVariable: string
  readonly services: readonly RecoveryNodeServiceConfig[]
}

export class RecoveryNodeConfigReader {
  public read(path: string): RecoveryNodeConfig {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const record = this.requireRecord(parsed, 'node config')
    const servicesValue = record['services']
    if (!Array.isArray(servicesValue) || servicesValue.length === 0) throw new Error('node config services must be a non-empty array')
    return {
      nodeId: this.requireString(record, 'nodeId'),
      listenHost: this.optionalString(record, 'listenHost') ?? '127.0.0.1',
      listenPort: this.optionalNumber(record, 'listenPort') ?? 7843,
      tokenEnvironmentVariable: this.requireString(record, 'tokenEnvironmentVariable'),
      services: servicesValue.map((value, index) => {
        const service = this.requireRecord(value, `services[${index}]`)
        return {
          id: this.requireString(service, 'id'),
          unit: this.requireString(service, 'unit'),
          healthChecks: this.readHealthChecks(service, `services[${index}].healthChecks`),
        }
      }),
    }
  }

  private readHealthChecks(
    service: Readonly<Record<string, unknown>>,
    label: string,
  ): readonly ServiceHealthCheckDefinition[] {
    const value = service['healthChecks']
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error(`${label} must be an array when provided`)

    return value.map((checkValue, index) => {
      const record = this.requireRecord(checkValue, `${label}[${index}]`)
      const type = this.requireString(record, 'type')
      const timeoutMs = this.optionalBoundedPositiveInteger(record, 'timeoutMs', 60_000) ?? 2_000

      if (type === 'http') {
        const url = this.requireHttpUrl(record, 'url')
        const expectedStatusCodes = this.readExpectedStatusCodes(record, `${label}[${index}].expectedStatusCodes`)
        return { type: 'http' as const, url, timeoutMs, expectedStatusCodes }
      }

      if (type === 'tcp') {
        return {
          type: 'tcp' as const,
          host: this.requireString(record, 'host'),
          port: this.requireTcpPort(record, 'port'),
          timeoutMs,
        }
      }

      throw new Error(`${label}[${index}].type must be http or tcp`)
    })
  }

  private readExpectedStatusCodes(
    record: Readonly<Record<string, unknown>>,
    label: string,
  ): readonly number[] {
    const value = record['expectedStatusCodes']
    if (value === undefined) return [200]
    if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array when provided`)
    const statuses = value.map((status) => {
      if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
        throw new Error(`${label} values must be integer HTTP status codes from 100 through 599`)
      }
      return status
    })
    if (new Set(statuses).size !== statuses.length) throw new Error(`${label} must not contain duplicates`)
    return statuses
  }

  private requireHttpUrl(record: Readonly<Record<string, unknown>>, key: string): string {
    const raw = this.requireString(record, key)
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error(`${key} must be a valid HTTP or HTTPS URL`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${key} must use http or https`)
    if (url.username.length > 0 || url.password.length > 0) throw new Error(`${key} must not contain embedded credentials`)
    return url.toString()
  }

  private requireTcpPort(record: Readonly<Record<string, unknown>>, key: string): number {
    const value = record[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65_535) {
      throw new Error(`${key} must be a TCP port from 1 through 65535`)
    }
    return value
  }

  private requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
    return value as Readonly<Record<string, unknown>>
  }

  private requireString(record: Readonly<Record<string, unknown>>, key: string): string {
    const value = record[key]
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-blank string`)
    return value.trim()
  }

  private optionalString(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-blank string when provided`)
    return value.trim()
  }

  private optionalNumber(record: Readonly<Record<string, unknown>>, key: string): number | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 65_535) throw new Error(`${key} must be a valid TCP port`)
    return value
  }

  private optionalBoundedPositiveInteger(
    record: Readonly<Record<string, unknown>>,
    key: string,
    maximum: number,
  ): number | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > maximum) {
      throw new Error(`${key} must be a positive integer no greater than ${maximum}`)
    }
    return value
  }
}
