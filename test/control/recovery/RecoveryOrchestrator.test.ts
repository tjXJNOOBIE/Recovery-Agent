import assert from 'node:assert/strict'
import test from 'node:test'

import { InMemoryIncidentRepository } from '../../../src/control/incident/repository/InMemoryIncidentRepository.js'
import { RecoveryPolicyResolver } from '../../../src/control/policy/RecoveryPolicyResolver.js'
import { RecoveryOrchestrator } from '../../../src/control/recovery/RecoveryOrchestrator.js'
import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'

test('recoversStoppedServiceDeterministicallyAndVerifiesHealth', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const incidents = new InMemoryIncidentRepository()
  const investigator = new FakeRecoveryInvestigator()
  const orchestrator = new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidents, investigator)

  try {
    const result = await orchestrator.recover(gateway, { nodeId: 'node-a', serviceId: 'worker', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 2 })
    assert.equal(result.status, 'recovered')
    assert.equal(result.restartAttempts, 1)
    assert.equal(result.snapshot.healthy, true)
    assert.equal(investigator.calls, 0)
    assert.equal(result.incident?.status, 'resolved')
  } finally {
    await server.close()
  }
})

test('escalatesAfterRecoveryBudgetAndInvokesInvestigatorWithoutAiMutation', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: false },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const incidents = new InMemoryIncidentRepository()
  const investigator = new FakeRecoveryInvestigator({ summary: 'deployment regression suspected', requiresHuman: true })
  const orchestrator = new RecoveryOrchestrator(new RecoveryPolicyResolver(), incidents, investigator)

  try {
    const result = await orchestrator.recover(gateway, { nodeId: 'node-a', serviceId: 'payments', expectedState: 'running', restartAllowed: true, maxRestartAttempts: 1 })
    assert.equal(result.status, 'escalated')
    assert.equal(result.restartAttempts, 1)
    assert.equal(investigator.calls, 1)
    assert.equal(result.incident?.status, 'human_required')
    assert.match(result.investigationSummary ?? '', /deployment regression/)
  } finally {
    await server.close()
  }
})
