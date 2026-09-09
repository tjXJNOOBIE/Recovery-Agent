import type { NodeResourceSnapshot } from '../../../node/data/NodeResourceSnapshot.js'
import type {
  RecoveryNodeNumericResourceMetric,
  RecoveryNodeResourceThresholds,
  RecoveryNodeResourceViolation,
} from './RecoveryNodeWatchDefinition.js'

export class RecoveryNodeResourceEvaluator {
  public evaluate(
    resources: NodeResourceSnapshot,
    thresholds: RecoveryNodeResourceThresholds,
  ): readonly RecoveryNodeResourceViolation[] {
    const violations: RecoveryNodeResourceViolation[] = []
    this.appendIfExceeded(violations, 'memory_used_percent', resources.memoryUsedPercent, thresholds.maxMemoryUsedPercent)
    this.appendIfExceeded(violations, 'swap_used_percent', resources.swapUsedPercent, thresholds.maxSwapUsedPercent)
    this.appendIfExceeded(violations, 'root_filesystem_used_percent', resources.rootFilesystemUsedPercent, thresholds.maxRootFilesystemUsedPercent)
    if (resources.rootFilesystemInodeUsedPercent !== undefined) {
      this.appendIfExceeded(
        violations,
        'root_filesystem_inode_used_percent',
        resources.rootFilesystemInodeUsedPercent,
        thresholds.maxRootFilesystemInodeUsedPercent,
      )
    }
    this.appendIfExceeded(violations, 'load_average_1m_per_cpu', resources.loadAverage1mPerCpu, thresholds.maxLoadAverage1mPerCpu)
    if (resources.rootFilesystemReadOnly === true) {
      violations.push({ metric: 'root_filesystem_read_only', value: true, expected: false })
    }
    return violations
  }

  private appendIfExceeded(
    violations: RecoveryNodeResourceViolation[],
    metric: RecoveryNodeNumericResourceMetric,
    value: number,
    threshold: number,
  ): void {
    if (!Number.isFinite(value)) throw new Error(`Node resource metric ${metric} must be finite`)
    if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`Node resource threshold ${metric} must be a finite non-negative number`)
    if (value > threshold) violations.push({ metric, value, threshold })
  }
}
