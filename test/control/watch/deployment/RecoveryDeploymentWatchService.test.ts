import assert from 'node:assert/strict'
import test from 'node:test'

import type { FleetStatusResult } from '../../../../src/control/runtime/RecoveryControlRuntime.js'
import { RecoveryDeploymentWatchService } from '../../../../src/control/watch/deployment/RecoveryDeploymentWatchService.js'

class FakeFleetRuntime {
  public healthy = true
  public marker = 'a'
  public async fleetStatus(): Promise<FleetStatusResult> {
    return {
      nodes: [{
        nodeId: 'node-a', observedAt: '2026-09-08T00:00:00.000Z',
        services: [{
          nodeId: 'node-a', serviceId: 'payments', lifecycleState: 'running', healthy: this.healthy, detail: 'test', observedAt: '2026-09-08T00:00:00.000Z', restartCount: 0,
          deployment: { observedAt: '2026-09-08T00:00:00.000Z', available: true, marker: this.marker, deployedAt: '2026-09-08T00:00:00.000Z' },
        }],
      }],
      unreachableNodes: [], healthyServices: this.healthy ? 1 : 0, unhealthyServices: this.healthy ? 0 : 1,
    }
  }
}

test('correlatesNewDeploymentWithRegressionBeforeStabilizingAndResolving', async () => {
  const runtime = new FakeFleetRuntime()
  const watch = new RecoveryDeploymentWatchService(runtime, 30_000, 5_000, 600_000)
  let states = await watch.runNow(0)
  assert.equal(states[0]?.status, 'baseline')
  runtime.marker = 'b'; runtime.healthy = false
  states = await watch.runNow(1_000)
  assert.equal(states[0]?.status, 'regressed')
  const incidentId = states[0]?.incidentId; assert.ok(incidentId); assert.equal(watch.listIncidents()[0]?.status, 'open')
  runtime.healthy = true
  states = await watch.runNow(2_000)
  assert.equal(states[0]?.status, 'stabilizing'); assert.equal(states[0]?.incidentId, incidentId)
  states = await watch.runNow(602_000)
  assert.equal(states[0]?.status, 'stable'); assert.equal(watch.listIncidents()[0]?.status, 'resolved')
})

test('markerChangeWhileHealthyStartsStabilizationWithoutOpeningIncident', async () => {
  const runtime = new FakeFleetRuntime(); const watch = new RecoveryDeploymentWatchService(runtime, 30_000, 5_000, 600_000)
  await watch.runNow(0); runtime.marker = 'next'
  const states = await watch.runNow(1)
  assert.equal(states[0]?.status, 'stabilizing'); assert.equal(watch.listIncidents().length, 0)
})
