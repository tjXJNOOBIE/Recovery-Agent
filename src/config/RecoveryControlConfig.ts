import { readFileSync } from 'node:fs'

export interface RecoveryControlServiceDependencyConfig { readonly nodeId: string; readonly serviceId: string }
export interface RecoveryControlServiceConfig { readonly id: string; readonly restartAllowed: boolean; readonly maxRestartAttempts: number; readonly restartBudgetWindowSeconds: number; readonly watchEnabled: boolean; readonly watchIntervalSeconds: number; readonly dependencies: readonly RecoveryControlServiceDependencyConfig[] }
export interface RecoveryControlNodeConfig { readonly id: string; readonly baseUrl: string; readonly tokenEnvironmentVariable: string; readonly services: readonly RecoveryControlServiceConfig[] }
export interface RecoveryApprovalPrincipalConfig { readonly id: string; readonly tokenEnvironmentVariable: string; readonly revoked: boolean; readonly expiresAt?: string }
export interface RecoveryDurableRetentionConfig { readonly terminalHistoryDays: number; readonly terminalHistoryPerTarget: number }
export interface RecoveryControlConfig { readonly nodes: readonly RecoveryControlNodeConfig[]; readonly approvalPrincipals: readonly RecoveryApprovalPrincipalConfig[]; readonly durableRetention?: RecoveryDurableRetentionConfig }

export class RecoveryControlConfigReader {
  public read(path: string): RecoveryControlConfig {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const record = this.requireRecord(parsed, 'control config')
    const nodesValue = record['nodes']
    if (!Array.isArray(nodesValue) || nodesValue.length === 0) throw new Error('control config nodes must be a non-empty array')

    const durableRetention = this.readDurableRetention(record)
    const config: RecoveryControlConfig = {
      nodes: nodesValue.map((value, nodeIndex) => {
        const node = this.requireRecord(value, `nodes[${nodeIndex}]`)
        const nodeId = this.requireString(node, 'id')
        const servicesValue = node['services']
        if (!Array.isArray(servicesValue) || servicesValue.length === 0) throw new Error(`nodes[${nodeIndex}].services must be non-empty`)
        return {
          id: nodeId,
          baseUrl: this.requireString(node, 'baseUrl'),
          tokenEnvironmentVariable: this.requireString(node, 'tokenEnvironmentVariable'),
          services: servicesValue.map((serviceValue, serviceIndex) => {
            const service = this.requireRecord(serviceValue, `nodes[${nodeIndex}].services[${serviceIndex}]`)
            return {
              id: this.requireString(service, 'id'),
              restartAllowed: this.requireBoolean(service, 'restartAllowed'),
              maxRestartAttempts: this.requireNonNegativeInteger(service, 'maxRestartAttempts'),
              restartBudgetWindowSeconds: this.optionalPositiveInteger(service, 'restartBudgetWindowSeconds') ?? 600,
              watchEnabled: this.optionalBoolean(service, 'watchEnabled') ?? true,
              watchIntervalSeconds: this.optionalPositiveInteger(service, 'watchIntervalSeconds') ?? 30,
              dependencies: this.readDependencies(service, nodeId, nodeIndex, serviceIndex),
            }
          }),
        }
      }),
      approvalPrincipals: this.readApprovalPrincipals(record),
      ...(durableRetention === undefined ? {} : { durableRetention }),
    }

    this.validateTopology(config)
    return config
  }

  private readDurableRetention(record: Readonly<Record<string, unknown>>): RecoveryDurableRetentionConfig | undefined {
    const value = record['durableRetention']
    if (value === undefined) return undefined
    const retention = this.requireRecord(value, 'control config durableRetention')
    return {
      terminalHistoryDays: this.requirePositiveInteger(retention, 'terminalHistoryDays'),
      terminalHistoryPerTarget: this.requirePositiveInteger(retention, 'terminalHistoryPerTarget'),
    }
  }

  private readApprovalPrincipals(record: Readonly<Record<string, unknown>>): readonly RecoveryApprovalPrincipalConfig[] {
    const value = record['approvalPrincipals']
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error('control config approvalPrincipals must be an array when provided')
    const ids = new Set<string>()
    const secretVariables = new Set<string>()
    return value.map((entry, index) => {
      const principal = this.requireRecord(entry, `approvalPrincipals[${index}]`)
      const id = this.requireString(principal, 'id')
      if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`approvalPrincipals[${index}].id may contain only letters, numbers, dot, underscore, and hyphen`)
      const tokenEnvironmentVariable = this.requireString(principal, 'tokenEnvironmentVariable')
      if (ids.has(id)) throw new Error(`Duplicate recovery approval principal id: ${id}`)
      if (secretVariables.has(tokenEnvironmentVariable)) throw new Error(`Recovery approval principals must not share token environment variable ${tokenEnvironmentVariable}`)
      ids.add(id)
      secretVariables.add(tokenEnvironmentVariable)
      const expiresAt = this.optionalString(principal, 'expiresAt')
      if (expiresAt !== undefined && !Number.isFinite(Date.parse(expiresAt))) throw new Error(`approvalPrincipals[${index}].expiresAt must be a valid timestamp`)
      return {
        id,
        tokenEnvironmentVariable,
        revoked: this.optionalBoolean(principal, 'revoked') ?? false,
        ...(expiresAt === undefined ? {} : { expiresAt: new Date(expiresAt).toISOString() }),
      }
    })
  }

  private readDependencies(service: Readonly<Record<string, unknown>>, defaultNodeId: string, nodeIndex: number, serviceIndex: number): readonly RecoveryControlServiceDependencyConfig[] {
    const dependenciesValue = service['dependencies']
    if (dependenciesValue === undefined) return []
    if (!Array.isArray(dependenciesValue)) throw new Error(`nodes[${nodeIndex}].services[${serviceIndex}].dependencies must be an array when provided`)
    return dependenciesValue.map((dependencyValue, dependencyIndex) => {
      const dependency = this.requireRecord(dependencyValue, `nodes[${nodeIndex}].services[${serviceIndex}].dependencies[${dependencyIndex}]`)
      return { nodeId: this.optionalString(dependency, 'nodeId') ?? defaultNodeId, serviceId: this.requireString(dependency, 'serviceId') }
    })
  }

  private validateTopology(config: RecoveryControlConfig): void {
    const policies = new Map<string, RecoveryControlServiceConfig>()
    const nodeIds = new Set<string>()
    for (const node of config.nodes) {
      if (nodeIds.has(node.id)) throw new Error(`Duplicate recovery node id: ${node.id}`)
      nodeIds.add(node.id)
      const serviceIds = new Set<string>()
      for (const service of node.services) {
        if (serviceIds.has(service.id)) throw new Error(`Duplicate recovery service id on ${node.id}: ${service.id}`)
        serviceIds.add(service.id)
        policies.set(this.targetKey(node.id, service.id), service)
      }
    }
    for (const node of config.nodes) {
      for (const service of node.services) {
        const ownerKey = this.targetKey(node.id, service.id)
        const dependencies = new Set<string>()
        for (const dependency of service.dependencies) {
          const dependencyKey = this.targetKey(dependency.nodeId, dependency.serviceId)
          if (dependencyKey === ownerKey) throw new Error(`Recovery service ${ownerKey} cannot depend on itself`)
          if (!policies.has(dependencyKey)) throw new Error(`Recovery service ${ownerKey} references unknown dependency ${dependencyKey}`)
          if (dependencies.has(dependencyKey)) throw new Error(`Recovery service ${ownerKey} declares duplicate dependency ${dependencyKey}`)
          dependencies.add(dependencyKey)
        }
      }
    }
    const visiting = new Set<string>(); const visited = new Set<string>(); const dependenciesByTarget = new Map<string, readonly RecoveryControlServiceDependencyConfig[]>()
    for (const node of config.nodes) for (const service of node.services) dependenciesByTarget.set(this.targetKey(node.id, service.id), service.dependencies)
    const visit = (key: string): void => {
      if (visited.has(key)) return
      if (visiting.has(key)) throw new Error(`Recovery dependency cycle detected at ${key}`)
      visiting.add(key)
      for (const dependency of dependenciesByTarget.get(key) ?? []) visit(this.targetKey(dependency.nodeId, dependency.serviceId))
      visiting.delete(key); visited.add(key)
    }
    for (const key of dependenciesByTarget.keys()) visit(key)
  }

  private targetKey(nodeId: string, serviceId: string): string { return `${nodeId}/${serviceId}` }
  private requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`); return value as Readonly<Record<string, unknown>> }
  private requireString(record: Readonly<Record<string, unknown>>, key: string): string { const value = record[key]; if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-blank string`); return value.trim() }
  private optionalString(record: Readonly<Record<string, unknown>>, key: string): string | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} must be a non-blank string when provided`); return value.trim() }
  private requireBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean { const value = record[key]; if (typeof value !== 'boolean') throw new Error(`${key} must be boolean`); return value }
  private optionalBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'boolean') throw new Error(`${key} must be boolean when provided`); return value }
  private requireNonNegativeInteger(record: Readonly<Record<string, unknown>>, key: string): number { const value = record[key]; if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`); return value }
  private requirePositiveInteger(record: Readonly<Record<string, unknown>>, key: string): number { const value = this.requireNonNegativeInteger(record, key); if (value === 0) throw new Error(`${key} must be a positive integer`); return value }
  private optionalPositiveInteger(record: Readonly<Record<string, unknown>>, key: string): number | undefined { const value = record[key]; if (value === undefined) return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer when provided`); return value }
}
