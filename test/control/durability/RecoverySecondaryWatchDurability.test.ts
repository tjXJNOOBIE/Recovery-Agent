import assert from 'node:assert/strict'
import test from 'node:test'

import type { IRecoveryDurabilityStateCheckpoint } from '../../../src/control/durability/RecoveryDurabilityCheckpointBarrier.js'
import { RecoveryDurableStateParser } from '../../../src/control/durability/RecoveryDurableStateParser.js'
import { RecoveryWatchCoordinator } from '../../../src/control/watch/RecoveryWatchCoordinator.js'
import { RecoveryWatchService } from '../../../src/control/watch/RecoveryWatchService.js'
import { RecoveryDeploymentWatchService } from '../../../src/control/watch/deployment/RecoveryDeploymentWatchService.js'
import { RecoveryNodeWatchService } from '../../../src/control/watch/node/RecoveryNodeWatchService.js'
import { DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS } from '../../../src/control/watch/node/RecoveryNodeWatchDefinition.js'
import type { FleetStatusResult } from '../../../src/control/runtime/RecoveryControlRuntime.js'
import type { RecoveryRunResult } from '../../../src/control/recovery/RecoveryRunResult.js'

const parser = new RecoveryDurableStateParser()

function legacySnapshot(): Readonly<Record<string, unknown>> {
  return { schemaVersion: 1, incidents: [], plans: [], semanticWatches: [], restartAttempts: [], audit: [] }
}

test('normalizesLegacyV1SnapshotToSchemaV2SecondaryStateDefaults', () => {
  const parsed = parser.parseSnapshot(legacySnapshot())
  assert.equal(parsed.schemaVersion, 2)
  assert.deepEqual(parsed.nodeHealthIncidents, [])
  assert.deepEqual(parsed.certificateIncidents, [])
  assert.deepEqual(parsed.deploymentStates, [])
  assert.deepEqual(parsed.deploymentIncidents, [])
})

test('parsesStrictSchemaV2SecondaryWatchState', () => {
  const parsed = parser.parseSnapshot({
    ...legacySnapshot(),
    schemaVersion: 2,
    nodeHealthIncidents: [{
      id: 'node-incident-1',
      nodeId: 'east',
      status: 'open',
      openedAt: '2026-09-08T20:00:00.000Z',
      updatedAt: '2026-09-08T20:01:00.000Z',
      violations: [{ metric: 'memory_used_percent', value: 95, threshold: 92 }],
      timeline: [{ at: '2026-09-08T20:00:00.000Z', message: 'memory pressure' }],
    }],
    certificateIncidents: [{
      id: 'certificate-incident-1',
      nodeId: 'east',
      certificateId: 'api-tls',
      status: 'open',
      openedAt: '2026-09-08T20:00:00.000Z',
      updatedAt: '2026-09-08T20:01:00.000Z',
      message: 'certificate expires soon',
    }],
    deploymentStates: [{
      nodeId: 'east',
      serviceId: 'payments',
      status: 'stabilizing',
      marker: 'deploy-v2',
      previousMarker: 'deploy-v1',
      deploymentDetectedAt: '2026-09-08T20:00:00.000Z',
      stabilizationEndsAt: '2026-09-08T20:10:00.000Z',
      lastCheckedAt: '2026-09-08T20:01:00.000Z',
    }],
    deploymentIncidents: [],
  })

  assert.equal(parsed.nodeHealthIncidents[0]?.nodeId, 'east')
  assert.equal(parsed.certificateIncidents[0]?.certificateId, 'api-tls')
  assert.equal(parsed.deploymentStates[0]?.previousMarker, 'deploy-v1')
})

function deploymentFleet(marker: string): FleetStatusResult {
  const observedAt = '2026-09-08T20:00:00.000Z'
  return {
    nodes: [{
      nodeId: 'east',
      observedAt,
      services: [{
        nodeId: 'east',
        serviceId: 'payments',
        lifecycleState: 'running',
        healthy: true,
        detail: 'healthy',
        observedAt,
        restartCount: 0,
        deployment: { observedAt, available: true, marker },
      }],
    }],
    unreachableNodes: [],
    healthyServices: 1,
    unhealthyServices: 0,
  }
}

test('deploymentBaselineSurvivesNodeOutageAndStillDetectsChangedMarker', async () => {
  let fleet = deploymentFleet('deploy-v1')
  const watch = new RecoveryDeploymentWatchService(
    { fleetStatus: async () => fleet },
    30_000,
    5_000,
    600_000,
    [{ nodeId: 'east', serviceId: 'payments' }],
  )

  await watch.runNow(1_000)
  assert.equal(watch.listStates()[0]?.status, 'baseline')
  assert.equal(watch.listStates()[0]?.marker, 'deploy-v1')

  fleet = { nodes: [], unreachableNodes: [{ nodeId: 'east', error: 'offline' }], healthyServices: 0, unhealthyServices: 0 }
  await watch.runNow(2_000)
  assert.equal(watch.listStates()[0]?.status, 'unavailable')
  assert.equal(watch.listStates()[0]?.marker, 'deploy-v1')

  fleet = deploymentFleet('deploy-v2')
  await watch.runNow(3_000)
  assert.equal(watch.listStates()[0]?.status, 'stabilizing')
  assert.equal(watch.listStates()[0]?.marker, 'deploy-v2')
  assert.equal(watch.listStates()[0]?.previousMarker, 'deploy-v1')
})

class RecordingStateCheckpoint implements IRecoveryDurabilityStateCheckpoint {
  public readonly events: string[]
  public constructor(events: string[]) { this.events = events }
  public async checkpointState(): Promise<void> { this.events.push('checkpoint') }
}

test('causalWatchStateCheckpointsBeforeServiceRecoveryMutationPath', async () => {
  const events: string[] = []
  const recoveryRuntime = {
    async recoverService(nodeId: string, serviceId: string): Promise<RecoveryRunResult> {
      events.push('service-recovery')
      return {
        status: 'healthy',
        restartAttempts: 0,
        snapshot: {
          nodeId,
          serviceId,
          lifecycleState: 'running',
          healthy: true,
          detail: 'healthy',
          observedAt: '2026-09-08T20:00:00.000Z',
          restartCount: 0,
        },
      }
    },
  }
  const serviceWatches = new RecoveryWatchService(recoveryRuntime, [{ nodeId: 'east', serviceId: 'payments', intervalMs: 30_000 }])
  const nodeWatches = new RecoveryNodeWatchService(
    { inspectNode: async () => { throw new Error('node unavailable') } },
    [{ nodeId: 'east', intervalMs: 30_000, thresholds: DEFAULT_RECOVERY_NODE_RESOURCE_THRESHOLDS }],
  )
  const coordinator = new RecoveryWatchCoordinator(
    serviceWatches,
    nodeWatches,
    1_000,
    undefined,
    undefined,
    undefined,
    new RecordingStateCheckpoint(events),
  )

  await coordinator.runAllNow(1_000)
  assert.deepEqual(events, ['checkpoint', 'service-recovery'])
  assert.equal(coordinator.exportDurableState().nodeHealthIncidents.length, 1)
})
