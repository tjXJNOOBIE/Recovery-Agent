import assert from 'node:assert/strict'
import test from 'node:test'

import type { NodeResourceSnapshot } from '../../../../src/node/data/NodeResourceSnapshot.js'
import { RecoveryNodeResourceEvaluator } from '../../../../src/control/watch/node/RecoveryNodeResourceEvaluator.js'
import { DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS } from '../../../../src/control/watch/node/RecoveryNodeWatchDefinition.js'

const healthy: NodeResourceSnapshot = {
  observedAt: '2026-09-08T00:00:00.000Z',
  uptimeSeconds: 100,
  loadAverage1mPerCpu: 0.5,
  memoryTotalBytes: 1000,
  memoryAvailableBytes: 500,
  memoryUsedPercent: 50,
  swapTotalBytes: 1000,
  swapFreeBytes: 1000,
  swapUsedPercent: 0,
  rootFilesystemTotalBytes: 1000,
  rootFilesystemAvailableBytes: 500,
  rootFilesystemUsedPercent: 50,
}

test('reportsOnlyNodeResourceThresholdsThatAreExceeded', () => {
  const evaluator = new RecoveryNodeResourceEvaluator()
  assert.deepEqual(evaluator.evaluate(healthy, DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS), [])

  const violations = evaluator.evaluate({
    ...healthy,
    memoryUsedPercent: 95,
    rootFilesystemUsedPercent: 96,
  }, DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS)

  assert.deepEqual(violations.map((violation) => violation.metric), [
    'memory_used_percent',
    'root_filesystem_used_percent',
  ])
})
