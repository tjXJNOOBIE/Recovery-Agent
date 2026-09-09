import assert from 'node:assert/strict'
import test from 'node:test'

import type { NodeResourceSnapshot } from '../../../../src/node/data/NodeResourceSnapshot.js'
import type { NodeSnapshot } from '../../../../src/node/data/ServiceSnapshot.js'
import { DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS } from '../../../../src/control/watch/node/RecoveryNodeWatchDefinition.js'
import { RecoveryNodeWatchService } from '../../../../src/control/watch/node/RecoveryNodeWatchService.js'

const resources: NodeResourceSnapshot = {
  observedAt: '2026-09-08T00:00:00.000Z', uptimeSeconds: 100,
  loadAverage1mPerCpu: 0.2,
  memoryTotalBytes: 1000, memoryAvailableBytes: 500, memoryUsedPercent: 50,
  swapTotalBytes: 0, swapFreeBytes: 0, swapUsedPercent: 0,
  rootFilesystemTotalBytes: 1000, rootFilesystemAvailableBytes: 500, rootFilesystemUsedPercent: 50,
}

class MutableClockRuntime {
  public observedAtMs: number
  public constructor(observedAtMs: number) { this.observedAtMs = observedAtMs }
  public async inspectNode(_nodeId: string): Promise<NodeSnapshot> {
    return {
      nodeId: 'node-a',
      observedAt: new Date(this.observedAtMs).toISOString(),
      services: [],
      resources,
    }
  }
}

test('detectsClockDriftAgainstRequestMidpointAndClearsAfterClockRecovers', async () => {
  const clockValues = [1_000_000, 1_000_200, 2_000_000, 2_000_100]
  const runtime = new MutableClockRuntime(1_031_100)
  const watches = new RecoveryNodeWatchService(
    runtime,
    [{
      nodeId: 'node-a',
      intervalMs: 30_000,
      thresholds: DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS,
      maxClockDriftMs: 30_000,
    }],
    undefined,
    undefined,
    () => clockValues.shift() ?? Number.NaN,
  )

  const degraded = await watches.runAllNow(0)
  assert.equal(degraded[0]?.state.lastStatus, 'degraded')
  assert.equal(degraded[0]?.state.requestRoundTripMs, 200)
  assert.equal(degraded[0]?.state.clockDriftMs, 31_000)
  assert.deepEqual(degraded[0]?.state.violations, [{
    metric: 'node_clock_drift_ms',
    value: 31_000,
    threshold: 30_000,
  }])
  assert.equal(watches.listIncidents()[0]?.status, 'open')

  runtime.observedAtMs = 2_000_050
  const recovered = await watches.runAllNow(1)
  assert.equal(recovered[0]?.state.lastStatus, 'healthy')
  assert.equal(recovered[0]?.state.clockDriftMs, 0)
  assert.equal(recovered[0]?.state.requestRoundTripMs, 100)
  assert.equal(watches.listIncidents()[0]?.status, 'resolved')
})
