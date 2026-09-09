import { readFileSync } from 'node:fs'

import type { CertificateDefinition } from '../node/certificate/NodeCertificateProbe.js'
import type { ServiceHealthCheckDefinition } from '../node/health/ServiceHealthCheck.js'
import { RecoveryCertificateFingerprintPolicy } from '../node/transport/RecoveryCertificateFingerprintPolicy.js'

export interface RecoveryNodeServiceConfig { readonly id: string; readonly unit: string; readonly healthChecks: readonly ServiceHealthCheckDefinition[]; readonly deploymentMarkerFile?: string }
export interface RecoveryNodeLoopbackHttpTransportConfig { readonly mode: 'loopback_http'; readonly listenHost: string; readonly listenPort: number; readonly tokenEnvironmentVariable: string }
export interface RecoveryNodeOutboundTlsTransportConfig { readonly mode: 'outbound_tls'; readonly host: string; readonly port: number; readonly serverName: string; readonly certificateFile: string; readonly privateKeyFile: string; readonly controlCertificateAuthorityFile: string; readonly allowedControlCertificateFingerprints: readonly string[]; readonly enrollmentTimeoutMs: number; readonly reconnectInitialDelayMs: number; readonly reconnectMaximumDelayMs: number }
export type RecoveryNodeTransportConfig = RecoveryNodeLoopbackHttpTransportConfig | RecoveryNodeOutboundTlsTransportConfig
export interface RecoveryNodeConfig { readonly nodeId: string; readonly transport: RecoveryNodeTransportConfig; readonly services: readonly RecoveryNodeServiceConfig[]; readonly certificates: readonly CertificateDefinition[] }

export class RecoveryNodeConfigReader {
  public read(path: string): RecoveryNodeConfig {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const record = this.requireRecord(parsed, 'node config')
    const servicesValue = record['services']
    if (!Array.isArray(servicesValue) || servicesValue.length === 0) throw new Error('node config services must be a non-empty array')
    return {
      nodeId: this.requireString(record, 'nodeId'),
      transport: this.readTransport(record),
      certificates: this.readCertificates(record),
      services: servicesValue.map((value, index) => {
        const service = this.requireRecord(value, `services[${index}]`)
        const deploymentMarkerFile = this.optionalString(service, 'deploymentMarkerFile')
        return {
          id: this.requireString(service, 'id'),
          unit: this.requireString(service, 'unit'),
          healthChecks: this.readHealthChecks(service, `services[${index}].healthChecks`),
          ...(deploymentMarkerFile === undefined ? {} : { deploymentMarkerFile }),
        }
      }),
    }
  }

  private readTransport(record: Readonly<Record<string, unknown>>): RecoveryNodeTransportConfig {
    const value = record['transport']
    if (value === undefined) {
      return {
        mode: 'loopback_http',
        listenHost: this.requireLoopbackHost(this.optionalString(record, 'listenHost') ?? '127.0.0.1'),
        listenPort: this.optionalTcpPort(record, 'listenPort') ?? 7843,
        tokenEnvironmentVariable: this.requireString(record, 'tokenEnvironmentVariable'),
      }
    }

    const transport = this.requireRecord(value, 'node config transport')
    const mode = this.requireString(transport, 'mode')
    if (mode === 'loopback_http') {
      if (record['listenHost'] !== undefined || record['listenPort'] !== undefined || record['tokenEnvironmentVariable'] !== undefined) throw new Error('explicit loopback_http transport must keep listener/token settings inside transport')
      return {
        mode,
        listenHost: this.requireLoopbackHost(this.optionalString(transport, 'listenHost') ?? '127.0.0.1'),
        listenPort: this.optionalTcpPort(transport, 'listenPort') ?? 7843,
        tokenEnvironmentVariable: this.requireString(transport, 'tokenEnvironmentVariable'),
      }
    }
    if (mode !== 'outbound_tls') throw new Error('node config transport.mode must be loopback_http or outbound_tls')
    if (record['listenHost'] !== undefined || record['listenPort'] !== undefined || record['tokenEnvironmentVariable'] !== undefined) throw new Error('outbound_tls nodes must not configure inbound listener or bearer-token fields')

    const fingerprints = transport['allowedControlCertificateFingerprints']
    if (!Array.isArray(fingerprints) || fingerprints.length === 0) throw new Error('node transport allowedControlCertificateFingerprints must be a non-empty array')
    const values = fingerprints.map((fingerprint, index) => {
      if (typeof fingerprint !== 'string') throw new Error(`node transport allowedControlCertificateFingerprints[${index}] must be a string`)
      return fingerprint
    })
    const host = this.requireString(transport, 'host')
    const reconnectInitialDelayMs = this.optionalBoundedPositiveInteger(transport, 'reconnectInitialDelayMs', 300_000) ?? 1_000
    const reconnectMaximumDelayMs = this.optionalBoundedPositiveInteger(transport, 'reconnectMaximumDelayMs', 300_000) ?? 30_000
    if (reconnectMaximumDelayMs < reconnectInitialDelayMs) throw new Error('node transport reconnectMaximumDelayMs must be greater than or equal to reconnectInitialDelayMs')
    return {
      mode,
      host,
      port: this.requireTcpPort(transport, 'port'),
      serverName: this.optionalString(transport, 'serverName') ?? host,
      certificateFile: this.requireString(transport, 'certificateFile'),
      privateKeyFile: this.requireString(transport, 'privateKeyFile'),
      controlCertificateAuthorityFile: this.requireString(transport, 'controlCertificateAuthorityFile'),
      allowedControlCertificateFingerprints: new RecoveryCertificateFingerprintPolicy(values).list(),
      enrollmentTimeoutMs: this.optionalBoundedPositiveInteger(transport, 'enrollmentTimeoutMs', 120_000) ?? 5_000,
      reconnectInitialDelayMs,
      reconnectMaximumDelayMs,
    }
  }

  private readCertificates(record: Readonly<Record<string, unknown>>): readonly CertificateDefinition[] {
    const value = record['certificates']; if (value === undefined) return []; if (!Array.isArray(value)) throw new Error('certificates must be an array when provided')
    const definitions = value.map((item, index) => { const certificate = this.requireRecord(item, `certificates[${index}]`); const host = this.requireString(certificate, 'host'); const warnBeforeDays = this.optionalBoundedPositiveInteger(certificate, 'warnBeforeDays', 3650) ?? 30; const criticalBeforeDays = this.optionalNonNegativeInteger(certificate, 'criticalBeforeDays', 3650) ?? 7; if (criticalBeforeDays >= warnBeforeDays) throw new Error(`certificates[${index}].criticalBeforeDays must be less than warnBeforeDays`); return { id: this.requireString(certificate, 'id'), host, port: this.optionalTcpPort(certificate, 'port') ?? 443, serverName: this.optionalString(certificate, 'serverName') ?? host, timeoutMs: this.optionalBoundedPositiveInteger(certificate, 'timeoutMs', 60_000) ?? 3_000, warnBeforeDays, criticalBeforeDays } })
    if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) throw new Error('certificate IDs must be unique'); return definitions
  }

  private readHealthChecks(service: Readonly<Record<string, unknown>>, label: string): readonly ServiceHealthCheckDefinition[] {
    const value = service['healthChecks']; if (value === undefined) return []; if (!Array.isArray(value)) throw new Error(`${label} must be an array when provided`)
    return value.map((checkValue, index) => { const record = this.requireRecord(checkValue, `${label}[${index}]`); const type = this.requireString(record, 'type'); const timeoutMs = this.optionalBoundedPositiveInteger(record, 'timeoutMs', 60_000) ?? 2_000; if (type === 'http') return { type: 'http' as const, url: this.requireHttpUrl(record, 'url'), timeoutMs, expectedStatusCodes: this.readExpectedStatusCodes(record, `${label}[${index}].expectedStatusCodes`) }; if (type === 'tcp') return { type: 'tcp' as const, host: this.requireString(record, 'host'), port: this.requireTcpPort(record, 'port'), timeoutMs }; throw new Error(`${label}[${index}].type must be http or tcp`) })
  }

  private readExpectedStatusCodes(record: Readonly<Record<string, unknown>>, label: string): readonly number[] { const value = record['expectedStatusCodes']; if (value === undefined) return [200]; if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array when provided`); const statuses = value.map((status) => { if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) throw new Error(`${label} values must be integer HTTP status codes from 100 through 599`); return status }); if (new Set(statuses).size !== statuses.length) throw new Error(`${label} must not contain duplicates`); return statuses }
  private requireHttpUrl(record: Readonly<Record<string, unknown>>, key: string): string { const raw = this.requireString(record, key); let url: URL; try { url = new URL(raw) } catch { throw new Error(`${key} must be a valid HTTP or HTTPS URL`) }; if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${key} must use http or https`); if (url.username.length > 0 || url.password.length > 0) throw new Error(`${key} must not contain embedded credentials`); return url.toString() }
  private requireLoopbackHost(value: string): string { const normalized = value.trim().toLowerCase(); if (normalized !== 'localhost' && normalized !== '127.0.0.1' && normalized !== '::1') throw new Error('loopback_http listenHost must be localhost, 127.0.0.1, or ::1'); return value.trim() }
  private requireTcpPort(record: Readonly<Record<string, unknown>>, key: string): number { const value = record[key]; if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`${key} must be a TCP port from 1 through 65535`); return value }
  private optionalTcpPort(record: Readonly<Record<string, unknown>>, key: string): number | undefined { const value = record[key]; return value === undefined ? undefined : this.requireTcpPort(record, key) }
  private requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Readonly<Record<string, unknown>> }
  private requireString(record: Readonly<Record<string, unknown>>, key: string): string { const value = record[key]; if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-blank string`); return value.trim() }
  private optionalString(record: Readonly<Record<string, unknown>>, key: string): string | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-blank string when provided`); return value.trim() }
  private optionalBoundedPositiveInteger(record: Readonly<Record<string, unknown>>, key: string, maximum: number): number | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > maximum) throw new Error(`${key} must be a positive integer no greater than ${maximum}`); return value }
  private optionalNonNegativeInteger(record: Readonly<Record<string, unknown>>, key: string, maximum: number): number | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${key} must be a non-negative integer no greater than ${maximum}`); return value }
}
