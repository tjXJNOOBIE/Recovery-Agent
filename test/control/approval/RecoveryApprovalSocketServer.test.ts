import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RecoveryApprovalSocketClient } from '../../../src/control/approval/socket/RecoveryApprovalSocketClient.js'
import { RecoveryApprovalSocketServer } from '../../../src/control/approval/socket/RecoveryApprovalSocketServer.js'
import { DemoNodeServiceRuntime } from '../../../src/demo/runtime/DemoNodeServiceRuntime.js'
import { HttpNodeAgentGateway } from '../../../src/node/http/HttpNodeAgentGateway.js'
import { NodeAgentHttpServer } from '../../../src/node/http/NodeAgentHttpServer.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { FakeRecoveryPlanner } from '../../fake/FakeRecoveryPlanner.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

test('keepsApprovalOffMcpAndExecutesOnlyThroughOwnerOnlyControlSocket', async () => {
  const nodeToken = 'test-node-token-1234567890'
  const approvalToken = 'approval-token-1234567890'
  const nodeServer = new NodeAgentHttpServer(new DemoNodeServiceRuntime('node-a', [
    { id: 'payments', lifecycleState: 'failed', healthy: false, restartRestoresHealth: true },
  ]), nodeToken)
  const nodeAddress = await nodeServer.listen()
  const gateway = new HttpNodeAgentGateway('node-a', nodeAddress.baseUrl, nodeToken)
  const policy = { nodeId: 'node-a', serviceId: 'payments', expectedState: 'running' as const, restartAllowed: true, maxRestartAttempts: 0 }
  const graph = buildRecoveryTestGraph(
    [gateway],
    [policy],
    new FakeRecoveryInvestigator(),
    new FakeRecoveryPlanner({ action: 'restart_service', rationale: 'One approved restart is evidence-supported.' }),
    approvalToken,
  )
  const directory = mkdtempSync(join(tmpdir(), 'recovery-approval-test-'))
  const socketPath = join(directory, 'approval.sock')
  const approvalServer = new RecoveryApprovalSocketServer(graph.control, socketPath)

  try {
    const recovery = await graph.control.recoverService('node-a', 'payments')
    assert.equal(recovery.status, 'approval_required')
    const planId = recovery.recoveryPlan?.id
    assert.ok(planId)

    await approvalServer.listen()
    assert.equal(statSync(socketPath).mode & 0o777, 0o600)

    const wrongClient = new RecoveryApprovalSocketClient(socketPath, 'wrong-approval-token-0000')
    await assert.rejects(wrongClient.approve(planId), /approval token is invalid/)
    assert.equal((await graph.control.inspectService('node-a', 'payments')).healthy, false)

    const approved = await new RecoveryApprovalSocketClient(socketPath, approvalToken).approve(planId) as {
      restoredHealth: boolean
      plan: {status: string}
    }
    assert.equal(approved.restoredHealth, true)
    assert.equal(approved.plan.status, 'executed')
    assert.equal((await graph.control.inspectService('node-a', 'payments')).healthy, true)
  } finally {
    await approvalServer.close()
    await graph.control.close()
    await nodeServer.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
