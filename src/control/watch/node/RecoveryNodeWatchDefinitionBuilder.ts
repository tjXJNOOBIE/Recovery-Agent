import type { RecoveryControlConfig } from '../../../config/RecoveryControlConfig.js'
import {
  DEFAULT_RECOVERY_NODE_MAX_CLOCK_DRIFT_MS,
  DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS,
  type RecoveryNodeWatchDefinition,
} from './RecoveryNodeWatchDefinition.js'

export class RecoveryNodeWatchDefinitionBuilder {
  public build(config: RecoveryControlConfig): readonly RecoveryNodeWatchDefinition[] {
    return config.nodes.map((node) => ({
      nodeId: node.id,
      intervalMs: 30_000,
      thresholds: DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS,
      maxClockDriftMs: DEFAULT_RECOVERY_NODE_MAX_CLOCK_DRIFT_MS,
    }))
  }
}
