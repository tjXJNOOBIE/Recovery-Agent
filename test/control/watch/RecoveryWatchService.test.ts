import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryWatchService } from '../../../src/control/watch/RecoveryWatchService.js'
import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

test('runsDueWatchesThroughBoundedRecoveryAndSkipsUntilIntervalElapses', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'worker', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 1 }
  const graph = buildRecoveryTestGraph([gateway], [policy], new FakeRecoveryInvestigator())
  const watches = new RecoveryWatchService(graph.control, [
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
    await graph.control.close()
    await server.close()
  }
})

test('capturesWatchFailureAsRuntimeStateInsteadOfCrashingTheWatchLoop', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'running', healthy: true, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const graph = buildRecoveryTestGraph([gateway], [], new FakeRecoveryInvestigator())
  const watches = new RecoveryWatchService(graph.control, [
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
    await graph.control.close()
    await server.close()
  }
})
