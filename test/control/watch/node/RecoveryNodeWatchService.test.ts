import assert from 'node:assert/strict'
import test from 'node:test'

import type { NodeResourceSnapshot } from '../../../../src/node/data/NodeResourceSnapshot.js'
import type { NodeSnapshot } from '../../../../src/node/data/ServiceSnapshot.js'
import { DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS } from '../../../../src/control/watch/node/RecoveryNodeWatchDefinition.js'
import { RecoveryNodeWatchService } from '../../../../src/control/watch/node/RecoveryNodeWatchService.js'

const baseResources: NodeResourceSnapshot = {
  observedAt: '2026-09-08T00:00:00.000Z', uptimeSeconds: 100,
  loadAverage1mPerCpu: 0.2,
  memoryTotalBytes: 1000, memoryAvailableBytes: 500, memoryUsedPercent: 50,
  swapTotalBytes: 1000, swapFreeBytes: 1000, swapUsedPercent: 0,
  rootFilesystemTotalBytes: 1000, rootFilesystemAvailableBytes: 500, rootFilesystemUsedPercent: 50,
}

class SequencedNodeInspectionRuntime {
  public snapshot: NodeSnapshot | Error
  public constructor(snapshot: NodeSnapshot | Error) { this.snapshot = snapshot }
  public async inspectNode(_nodeId: string): Promise<NodeSnapshot> {
    if (this.snapshot instanceof Error) throw this.snapshot
    return this.snapshot
  }
}

function node(resources?: NodeResourceSnapshot): NodeSnapshot {
  return {
    nodeId: 'node-a',
    observedAt: '2026-09-08T00:00:00.000Z',
    services: [],
    ...(resources === undefined ? {} : { resources }),
  }
}

test('opensAndClearsNodeHealthIncidentFromDeterministicResourceEvidence', async () => {
  const runtime = new SequencedNodeInspectionRuntime(node({ ...baseResources, memoryUsedPercent: 97 }))
  const watches = new RecoveryNodeWatchService(runtime, [{
    nodeId: 'node-a', intervalMs: 30_000, thresholds: DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS,
  }])

  const degraded = await watches.runAllNow(0)
  assert.equal(degraded[0]?.state.lastStatus, 'degraded')
  assert.deepEqual(degraded[0]?.state.violations.map((violation) => violation.metric), ['memory_used_percent'])
  const incidentId = degraded[0]?.state.incidentId
  assert.ok(incidentId)
  assert.equal(watches.listIncidents()[0]?.status, 'open')

  runtime.snapshot = node(baseResources)
  const recovered = await watches.runAllNow(1)
  assert.equal(recovered[0]?.state.lastStatus, 'healthy')
  assert.equal(watches.listIncidents()[0]?.status, 'resolved')
})

test('recordsUnreachableAndUnsupportedNodeWatchStatesWithoutMutation', async () => {
  const runtime = new SequencedNodeInspectionRuntime(new Error('connection refused'))
  const watches = new RecoveryNodeWatchService(runtime, [{
    nodeId: 'node-a', intervalMs: 30_000, thresholds: DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS,
  }])

  const unreachable = await watches.runAllNow(0)
  assert.equal(unreachable[0]?.state.lastStatus, 'unreachable')
  assert.equal(unreachable[0]?.state.lastError, 'connection refused')
  assert.equal(watches.listIncidents()[0]?.status, 'open')

  runtime.snapshot = node()
  const unsupported = await watches.runAllNow(1)
  assert.equal(unsupported[0]?.state.lastStatus, 'unsupported')
  assert.equal(unsupported[0]?.state.incidentId, watches.listIncidents()[0]?.id)
})
