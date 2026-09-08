import assert from 'node:assert/strict'
import test from 'node:test'

import { InMemoryIncidentRepository } from '../../../src/control/incident/repository/InMemoryIncidentRepository.js'
import { RecoveryPolicyResolver } from '../../../src/control/policy/RecoveryPolicyResolver.js'
import { RecoveryOrchestrator } from '../../../src/control/recovery/RecoveryOrchestrator.js'
import { RecoveryControlRuntime } from '../../../src/control/runtime/RecoveryControlRuntime.js'
import { RecoveryWatchService } from '../../../src/control/watch/RecoveryWatchService.js'
import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'

test('runsDueWatchesThroughBoundedRecoveryAndSkipsUntilIntervalElapses', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const incidents = new InMemoryIncidentRepository()
  const control = new RecoveryControlRuntime(
    [new HttpNodeAgentGateway('node-a', address.baseUrl, token)],
    [{ nodeId: 'node-a', serviceId: 'worker', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 1 }],
    new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidents, new FakeRecoveryInvestigator()),
    incidents,
  )
  const watches = new RecoveryWatchService(control, [
    { nodeId: 'node-a', serviceId: 'worker', intervalMs: 1_000 },
  ])

  try {
    const first = await watches.runDueWatches(10_000)
    assert.equal(first.length, 1)
    assert.equal(first[0]?.recovery?.status, 'recovered')

    const early = await watches.runDueWatches(10_999)
    assert.equal(early.length, 0)

    const dueAgain = await watches.runDueWatches(11_000)
    assert.equal(dueAgain.length, 1)
    assert.equal(dueAgain[0]?.recovery?.status, 'healthy')

    const state = watches.listStates()[0]
    assert.equal(state?.lastStatus, 'healthy')
    assert.equal(state?.lastStartedAt, new Date(11_000).toISOString())
  } finally {
    await watches.close()
    await control.close()
    await server.close()
  }
})

test('capturesWatchFailureAsRuntimeStateInsteadOfCrashingTheWatchLoop', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'running', healthy: true, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const incidents = new InMemoryIncidentRepository()
  const control = new RecoveryControlRuntime(
    [new HttpNodeAgentGateway('node-a', address.baseUrl, token)],
    [],
    new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidents, new FakeRecoveryInvestigator()),
    incidents,
  )
  const watches = new RecoveryWatchService(control, [
    { nodeId: 'node-a', serviceId: 'worker', intervalMs: 1_000 },
  ])

  try {
    const result = await watches.runAllNow(20_000)
    assert.equal(result.length, 1)
    assert.match(result[0]?.error ?? '', /No recovery policy configured/)
    const state = watches.listStates()[0]
    assert.equal(state?.lastStatus, 'error')
    assert.match(state?.lastError ?? '', /No recovery policy configured/)
  } finally {
    await watches.close()
    await control.close()
    await server.close()
  }
})
