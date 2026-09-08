import { readFileSync } from 'node:fs'

export interface RecoveryControlServiceConfig {
  readonly id: string
  readonly restartAllowed: boolean
  readonly maxRestartAttempts: number
  readonly watchEnabled: boolean
  readonly watchIntervalSeconds: number
}

export interface RecoveryControlNodeConfig {
  readonly id: string
  readonly baseUrl: string
  readonly tokenEnvironmentVariable: string
  readonly services: readonly RecoveryControlServiceConfig[]
}

export interface RecoveryControlConfig {
  readonly nodes: readonly RecoveryControlNodeConfig[]
}

export class RecoveryControlConfigReader {
  public read(path: string): RecoveryControlConfig {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const record = this.requireRecord(parsed, 'control config')
    const nodesValue = record['nodes']
    if (!Array.isArray(nodesValue) || nodesValue.length === 0) throw new Error('control config nodes must be a non-empty array')
    return {
      nodes: nodesValue.map((value, nodeIndex) => {
        const node = this.requireRecord(value, `nodes[${nodeIndex}]`)
        const servicesValue = node['services']
        if (!Array.isArray(servicesValue) || servicesValue.length === 0) throw new Error(`nodes[${nodeIndex}].services must be non-empty`)
        return {
          id: this.requireString(node, 'id'),
          baseUrl: this.requireString(node, 'baseUrl'),
          tokenEnvironmentVariable: this.requireString(node, 'tokenEnvironmentVariable'),
          services: servicesValue.map((serviceValue, serviceIndex) => {
            const service = this.requireRecord(serviceValue, `nodes[${nodeIndex}].services[${serviceIndex}]`)
            return {
              id: this.requireString(service, 'id'),
              restartAllowed: this.requireBoolean(service, 'restartAllowed'),
              maxRestartAttempts: this.requireNonNegativeInteger(service, 'maxRestartAttempts'),
              watchEnabled: this.optionalBoolean(service, 'watchEnabled') ?? true,
              watchIntervalSeconds: this.optionalPositiveInteger(service, 'watchIntervalSeconds') ?? 30,
            }
          }),
        }
      }),
    }
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

  private requireBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean {
    const value = record[key]
    if (typeof value !== 'boolean') throw new Error(`${key} must be boolean`)
    return value
  }

  private optionalBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== 'boolean') throw new Error(`${key} must be boolean when provided`)
    return value
  }

  private requireNonNegativeInteger(record: Readonly<Record<string, unknown>>, key: string): number {
    const value = record[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`)
    return value
  }

  private optionalPositiveInteger(record: Readonly<Record<string, unknown>>, key: string): number | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer when provided`)
    return value
  }
}
