import { readFileSync } from 'node:fs'

export interface RecoveryNodeConfig {
  readonly nodeId: string
  readonly listenHost: string
  readonly listenPort: number
  readonly tokenEnvironmentVariable: string
  readonly services: readonly { readonly id: string; readonly unit: string }[]
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
        return { id: this.requireString(service, 'id'), unit: this.requireString(service, 'unit') }
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

  private optionalString(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-blank string when provided`)
    return value.trim()
  }

  private optionalNumber(record: Readonly<Record<string, unknown>>, key: string): number | undefined {
    const value = record[key]
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`${key} must be a valid TCP port`)
    return value
  }
}
