import assert from 'node:assert/strict'
import test from 'node:test'

import { InMemoryIncidentRepository } from '../../src/control/incident/repository/InMemoryIncidentRepository.js'
import { RecoveryPolicyResolver } from '../../src/control/policy/RecoveryPolicyResolver.js'
import { RecoveryOrchestrator } from '../../src/control/recovery/RecoveryOrchestrator.js'
import { RecoveryControlRuntime } from '../../src/control/runtime/RecoveryControlRuntime.js'
import { RecoveryWatchService } from '../../src/control/watch/RecoveryWatchService.js'
import { DemoNodeServiceRuntime } from '../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { RecoveryMcpToolRouter } from '../../src/mcp/RecoveryMcpToolRouter.js'
import { HttpNodeAgentGateway } from '../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../fake/FakeRecoveryInvestigator.js'

test('routesMcpRecoveryIntentIntoDeterministicControlRuntime', async () => {
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
  const watches = new RecoveryWatchService(control, [{ nodeId: 'node-a', serviceId: 'worker', intervalMs: 30_000 }])
  const router = new RecoveryMcpToolRouter(control, watches)

  try {
    const result = await router.callTool('service_recover', { nodeId: 'node-a', serviceId: 'worker' }) as {status: string}
    assert.equal(result.status, 'recovered')
    assert.equal(control.listIncidents().length, 1)
    assert.ok(router.listTools().some((tool) => tool.name === 'health_sweep'))
    assert.ok(router.listTools().some((tool) => tool.name === 'watch_run'))
  } finally {
    await watches.close()
    await control.close()
    await server.close()
  }
})
