import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryWatchService } from '../../src/control/watch/RecoveryWatchService.js'
import { DemoNodeServiceRuntime } from '../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { RecoveryMcpToolRouter } from '../../src/mcp/RecoveryMcpToolRouter.js'
import { HttpNodeAgentGateway } from '../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../fake/FakeRecoveryInvestigator.js'
import { FakeRecoveryPlanner } from '../fake/FakeRecoveryPlanner.js'
import { buildRecoveryTestGraph } from '../fake/RecoveryTestGraph.js'

test('routesMcpRecoveryIntentIntoDeterministicControlRuntime', async () => {
  const token = 'test-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'worker', lifecycleState: 'stopped', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'worker', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 1 }
  const graph = buildRecoveryTestGraph([gateway], [policy], new FakeRecoveryInvestigator())
  const watches = new RecoveryWatchService(graph.control, [{ nodeId: 'node-a', serviceId: 'worker', intervalMs: 30_000 }])
  const router = new RecoveryMcpToolRouter(graph.control, watches)

  try {
    const result = await router.callTool('service_recover', { nodeId: 'node-a', serviceId: 'worker' }) as {status: string}
    assert.equal(result.status, 'recovered')
    assert.equal(graph.control.listIncidents().length, 1)
    assert.ok(router.listTools().some((tool) => tool.name === 'health_sweep'))
    assert.ok(router.listTools().some((tool) => tool.name === 'watch_run'))
    assert.ok(router.listTools().some((tool) => tool.name === 'recovery_plan_approve'))
  } finally {
    await watches.close()
    await graph.control.close()
    await server.close()
  }
})

test('requiresOutOfBandApprovalTokenBeforeExecutingProposedRecoveryPlan', async () => {
  const token = 'test-token-1234567890'
  const approvalToken = 'approval-token-1234567890'
  const server = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
  ]), token)
  const address = await server.listen()
  const gateway = new HttpNodeAgentGateway('node-a', address.baseUrl, token)
  const policy = { nodeId: 'node-a', serviceId: 'payments', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 0 }
  const planner = new FakeRecoveryPlanner({ action: 'restart_service', rationale: 'One human-approved restart is evidence-supported.' })
  const graph = buildRecoveryTestGraph([gateway], [policy], new FakeRecoveryInvestigator(), planner, approvalToken)
  const watches = new RecoveryWatchService(graph.control, [])
  const router = new RecoveryMcpToolRouter(graph.control, watches)

  try {
    const recovery = await router.callTool('service_recover', { nodeId: 'node-a', serviceId: 'payments' }) as {status: string; recoveryPlan?: {id: string}}
    assert.equal(recovery.status, 'approval_required')
    const planId = recovery.recoveryPlan?.id
    assert.ok(planId)

    await assert.rejects(
      router.callTool('recovery_plan_approve', { planId, approvalToken: 'wrong-token-0000000' }),
      /approval token is invalid/,
    )

    const beforeApproval = await router.callTool('service_inspect', { nodeId: 'node-a', serviceId: 'payments' }) as {healthy: boolean}
    assert.equal(beforeApproval.healthy, false)

    const approved = await router.callTool('recovery_plan_approve', { planId, approvalToken }) as {restoredHealth: boolean; plan: {status: string}}
    assert.equal(approved.restoredHealth, true)
    assert.equal(approved.plan.status, 'executed')
  } finally {
    await watches.close()
    await graph.control.close()
    await server.close()
  }
})
