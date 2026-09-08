import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAutomaticRestartBudget } from '../../../src/control/budget/RecoveryAutomaticRestartBudget.js'
import type { ServiceActionResult } from '../../../src/node/data/ServiceActionResult.js'
import type { NodeSnapshot, ServiceSnapshot } from '../../../src/node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../../src/node/gateway/INodeAgentGateway.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { FakeRecoveryPlanner } from '../../fake/FakeRecoveryPlanner.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

class FlappingGateway implements INodeAgentGateway {
  public readonly nodeId = 'node-a'
  public restartCount = 0
  private healthy = false

  public fail(): void {
    this.healthy = false
  }

  public async inspectNode(): Promise<NodeSnapshot> {
    return { nodeId: this.nodeId, observedAt: new Date(0).toISOString(), services: [await this.inspectService('payments')] }
  }

  public async inspectService(serviceId: string): Promise<ServiceSnapshot> {
    return {
      nodeId: this.nodeId,
      serviceId,
      lifecycleState: this.healthy ? 'running' : 'failed',
      healthy: this.healthy,
      detail: this.healthy ? 'healthy' : 'failed',
      observedAt: new Date(0).toISOString(),
      restartCount: this.restartCount,
    }
  }

  public async restartService(serviceId: string): Promise<ServiceActionResult> {
    this.restartCount += 1
    this.healthy = true
    return {
      accepted: true,
      action: 'restart',
      message: 'restart accepted',
      snapshot: await this.inspectService(serviceId),
    }
  }

  public async close(): Promise<void> {}
}

test('flappingServiceCannotReceiveFreshAutomaticBudgetEveryRecoveryCall', async () => {
  let nowMs = 0
  const gateway = new FlappingGateway()
  const policy = {
    nodeId: 'node-a',
    serviceId: 'payments',
    expectedState: 'running' as const,
    restartAllowed: true,
    maxRestartAttempts: 2,
    restartBudgetWindowMs: 10_000,
  }
  const investigator = new FakeRecoveryInvestigator()
  const planner = new FakeRecoveryPlanner({ action: 'none', rationale: 'Rolling automatic restart budget is exhausted.' })
  const budget = new RecoveryAutomaticRestartBudget(() => nowMs)
  const graph = buildRecoveryTestGraph([gateway], [policy], investigator, planner, 'test-approval-token-1234', budget)

  try {
    const first = await graph.orchestrator.recover(gateway, policy)
    assert.equal(first.status, 'recovered')
    assert.equal(first.restartAttempts, 1)
    assert.equal(gateway.restartCount, 1)

    gateway.fail()
    nowMs = 100
    const second = await graph.orchestrator.recover(gateway, policy)
    assert.equal(second.status, 'recovered')
    assert.equal(second.restartAttempts, 1)
    assert.equal(gateway.restartCount, 2)

    gateway.fail()
    nowMs = 200
    const third = await graph.orchestrator.recover(gateway, policy)
    assert.equal(third.status, 'escalated')
    assert.equal(third.restartAttempts, 0)
    assert.equal(gateway.restartCount, 2)
    assert.equal(investigator.calls, 1)
    assert.equal(planner.calls, 1)
    assert.match(third.incident?.timeline.find((entry) => entry.message.includes('budget exhausted'))?.message ?? '', /2\/2/)
  } finally {
    await graph.control.close()
  }
})
