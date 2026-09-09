import assert from 'node:assert/strict'
import test from 'node:test'

import { ApprovedRecoveryExecutor } from '../../../src/control/approval/ApprovedRecoveryExecutor.js'
import { RecoveryApprovalVerifier } from '../../../src/control/approval/RecoveryApprovalVerifier.js'
import { RecoveryPlanApprovalHandler } from '../../../src/control/approval/RecoveryPlanApprovalHandler.js'
import { RecoveryAutomaticRestartBudget } from '../../../src/control/budget/RecoveryAutomaticRestartBudget.js'
import type { IRecoveryDurabilityCheckpoint } from '../../../src/control/durability/RecoveryDurabilityCheckpointBarrier.js'
import type { RecoveryDurableAuditRequest } from '../../../src/control/durability/RecoveryDurableStateCoordinator.js'
import { RecoveryIncidentRuntimeState } from '../../../src/control/incident/runtime/RecoveryIncidentRuntimeState.js'
import { RecoveryPolicyResolver } from '../../../src/control/policy/RecoveryPolicyResolver.js'
import type { ServiceRecoveryPolicy } from '../../../src/control/policy/ServiceRecoveryPolicy.js'
import { RecoveryEscalationHandler } from '../../../src/control/plan/RecoveryEscalationHandler.js'
import { RecoveryPlanRuntimeState } from '../../../src/control/plan/runtime/RecoveryPlanRuntimeState.js'
import { RecoveryOrchestrator } from '../../../src/control/recovery/RecoveryOrchestrator.js'
import type { NodeSnapshot, ServiceSnapshot } from '../../../src/node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../../src/node/gateway/INodeAgentGateway.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { FakeRecoveryPlanner } from '../../fake/FakeRecoveryPlanner.js'

const policy: ServiceRecoveryPolicy = {
  nodeId: 'node-a',
  serviceId: 'payments',
  expectedState: 'running',
  restartAllowed: true,
  maxRestartAttempts: 1,
  restartBudgetWindowMs: 600_000,
}

class CountingGateway implements INodeAgentGateway {
  public readonly nodeId = 'node-a'
  public restartCalls = 0
  public snapshot: ServiceSnapshot = {
    nodeId: 'node-a',
    serviceId: 'payments',
    lifecycleState: 'failed',
    healthy: false,
    detail: 'simulated failure',
    observedAt: '2026-09-08T21:00:00.000Z',
    restartCount: 0,
  }

  public async inspectNode(): Promise<NodeSnapshot> {
    return { nodeId: this.nodeId, observedAt: this.snapshot.observedAt, services: [this.snapshot] }
  }

  public async inspectService(_serviceId: string): Promise<ServiceSnapshot> {
    return this.snapshot
  }

  public async restartService(_serviceId: string) {
    this.restartCalls += 1
    return {
      accepted: true as const,
      action: 'restart' as const,
      message: 'restart accepted',
      snapshot: this.snapshot,
    }
  }

  public async close(): Promise<void> {}
}

class FailingCheckpoint implements IRecoveryDurabilityCheckpoint {
  public assertCalls = 0
  public checkpointCalls = 0
  public readonly requests: RecoveryDurableAuditRequest[] = []

  public assertMutationAllowed(): void {
    this.assertCalls += 1
  }

  public async checkpoint(request: RecoveryDurableAuditRequest): Promise<void> {
    this.checkpointCalls += 1
    this.requests.push(request)
    throw new Error('state authority unavailable')
  }
}

test('automaticRestartNeverExecutesWhenWriteAheadCheckpointFails', async () => {
  const gateway = new CountingGateway()
  const incidents = new RecoveryIncidentRuntimeState()
  const plans = new RecoveryPlanRuntimeState()
  const checkpoint = new FailingCheckpoint()
  const orchestrator = new RecoveryOrchestrator(
    new RecoveryPolicyResolver(),
    incidents,
    new RecoveryEscalationHandler(
      incidents,
      new FakeRecoveryInvestigator(),
      new FakeRecoveryPlanner(),
      plans,
    ),
    new RecoveryAutomaticRestartBudget(() => 1_000),
    checkpoint,
  )

  await assert.rejects(orchestrator.recover(gateway, policy), /state authority unavailable/)

  assert.equal(checkpoint.checkpointCalls, 1)
  assert.equal(checkpoint.requests[0]?.action, 'automatic_restart_intent')
  assert.equal(gateway.restartCalls, 0)
  assert.equal(orchestrator.listAutomaticRestartAttempts().length, 1)
  assert.match(incidents.list()[0]?.timeline.at(-1)?.message ?? '', /Restart attempt 1 requested/)
})

test('approvedRestartNeverExecutesWhenApprovalIntentCheckpointFails', async () => {
  const gateway = new CountingGateway()
  const incidents = new RecoveryIncidentRuntimeState()
  const plans = new RecoveryPlanRuntimeState()
  const checkpoint = new FailingCheckpoint()
  const incident = incidents.open('node-a', 'payments', 'recovery exhausted')
  const plan = plans.create({
    incidentId: incident.id,
    nodeId: 'node-a',
    serviceId: 'payments',
    rationale: 'one explicit approved restart',
  })
  const handler = new RecoveryPlanApprovalHandler(
    plans,
    incidents,
    new RecoveryApprovalVerifier('test-approval-token-1234'),
    new ApprovedRecoveryExecutor([gateway], [policy]),
    checkpoint,
  )

  await assert.rejects(
    handler.approveAndExecute(plan.id, 'test-approval-token-1234'),
    /state authority unavailable/,
  )

  assert.equal(checkpoint.checkpointCalls, 1)
  assert.equal(checkpoint.requests[0]?.action, 'approved_restart_intent')
  assert.equal(gateway.restartCalls, 0)
  assert.equal(plans.require(plan.id).status, 'approved')
})
