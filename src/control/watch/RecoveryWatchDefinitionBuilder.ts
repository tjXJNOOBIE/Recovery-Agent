import type { RecoveryControlConfig } from '../../config/RecoveryControlConfig.js'
import type { RecoveryWatchDefinition } from './RecoveryWatchDefinition.js'

export class RecoveryWatchDefinitionBuilder {
  public build(config: RecoveryControlConfig): readonly RecoveryWatchDefinition[] {
    return config.nodes.flatMap((node) => node.services
      .filter((service) => service.watchEnabled)
      .map((service) => ({
        nodeId: node.id,
        serviceId: service.id,
        intervalMs: service.watchIntervalSeconds * 1_000,
      })))
  }
}
