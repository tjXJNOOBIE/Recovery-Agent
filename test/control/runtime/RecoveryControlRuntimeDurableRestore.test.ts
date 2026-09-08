import assert from 'node:assert/strict'
import test from 'node:test'

import type { IncidentRecord } from '../../../src/control/incident/data/IncidentRecord.js'
import type { ServiceRecoveryPolicy } from '../../../src/control/policy/ServiceRecoveryPolicy.js'
import type { RecoveryPlan } from '../../../src/control/plan/RecoveryPlan.js'
import type { ServiceActionResult } from '../../../src/node/data/ServiceActionResult.js'
import type { NodeSnapshot, ServiceSnapshot } from '../../../src/node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../../src/node/gateway/INodeAgentGateway.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

const policy: ServiceRecoveryPolicy = {
  nodeId: 'node-a',
  serviceId: 'payments',
  expectedState: 'running',
  restartAllowed: true,
  maxRestartAttempts: 2,
  restartBudgetWindowMs: 600_000,
}

const recoveringIncident: IncidentRecord = {
  id: 'incident-approved',
  nodeId: 'node-a',
  serviceId: 'payments',
  openedAt: '2026-09-08T20:00:00.000Z',
  status: 'recovering',
  timeline: [
    { at: '2026-09-08T20:00:00.000Z', kind: 'detected', message: 'payments unhealthy' },
    { at: '2026-09-08T20:01:00.000Z', kind: 'approval', message: 'operator approved restart' },
  ],
}

const approvedPlan: RecoveryPlan = {
  id: 'plan-approved',
  incidentId: recoveringIncident.id,
  nodeId: 'node-a',
  serviceId: 'payments',
  action: { type: 'restart_service' },
  rationale: 'One approved restart',
  risk: 'elevated',
  status: 'approved',
  createdAt: '2026-09-08T20:00:30.000Z',
  updatedAt: '2026-09-08T20:01:00.000Z',
}

class HealthyGateway implements INodeAgentGateway {
  public readonly nodeId = 'node-a'
  public restartCalls = 0

  public async inspectNode(): Promise<NodeSnapshot> {
    return { nodeId: this.nodeId, observedAt: '2026-09-08T21:00:00.000Z', services: [await this.inspectService('payments')] }
  }

  public async inspectService(serviceId: string): Promise<ServiceSnapshot> {
    return {
      nodeId: this.nodeId,
      serviceId,
      lifecycleState: 'running',
      healthy: true,
      detail: 'healthy after uncertain prior execution',
      observedAt: '2026-09-08T21:00:00.000Z',
      restartCount: 1,
    }
  }

  public async restartService(serviceId: string): Promise<ServiceActionResult> {
    this.restartCalls += 1
    return {
      accepted: true,
      action: 'restart',
      message: 'unexpected restart',
      snapshot: await this.inspectService(serviceId),
    }
  }

  public async close(): Promise<void> {}
}

test('reconcilesDurablyApprovedPlanToHumanRequiredAfterControlHostRestart', () => {
  const graph = buildRecoveryTestGraph([], [policy], new FakeRecoveryInvestigator())

  graph.control.restoreDurableState({
    incidents: [recoveringIncident],
    plans: [approvedPlan],
    restartAttempts: [{ nodeId: 'node-a', serviceId: 'payments', atMs: 1_000 }],
  })

  const restoredPlan = graph.control.inspectRecoveryPlan(approvedPlan.id)
  assert.equal(restoredPlan.status, 'failed')
  assert.match(restoredPlan.outcome ?? '', /execution outcome is unknown/)

  const restoredIncident = graph.control.inspectIncident(recoveringIncident.id)
  assert.equal(restoredIncident.status, 'human_required')
  assert.match(restoredIncident.timeline.at(-1)?.message ?? '', /no durable verified outcome/)
})

test('freshHealthyInspectionResolvesUncertainApprovedExecutionWithoutAnotherRestart', async () => {
  const gateway = new HealthyGateway()
  const graph = buildRecoveryTestGraph([gateway], [policy], new FakeRecoveryInvestigator())

  try {
    graph.control.restoreDurableState({
      incidents: [recoveringIncident],
      plans: [approvedPlan],
      restartAttempts: [{ nodeId: 'node-a', serviceId: 'payments', atMs: 1_000 }],
    })

    const result = await graph.control.recoverService('node-a', 'payments')
    assert.equal(result.status, 'healthy')
    assert.equal(result.incident?.status, 'resolved')
    assert.equal(gateway.restartCalls, 0)
  } finally {
    await graph.control.close()
  }
})

test('reconcilesInterruptedRecoveringIncidentWithoutPlanToHumanRequired', () => {
  const graph = buildRecoveryTestGraph([], [policy], new FakeRecoveryInvestigator())
  const interrupted: IncidentRecord = {
    ...recoveringIncident,
    id: 'incident-interrupted',
    timeline: [{ at: '2026-09-08T20:00:00.000Z', kind: 'detected', message: 'automatic restart in progress' }],
  }

  graph.control.restoreDurableState({ incidents: [interrupted], plans: [], restartAttempts: [] })
  const restored = graph.control.inspectIncident(interrupted.id)
  assert.equal(restored.status, 'human_required')
  assert.match(restored.timeline.at(-1)?.message ?? '', /restarted while recovery was in progress/)
})

test('rejectsDurablePlanTargetThatDoesNotMatchItsIncident', () => {
  const graph = buildRecoveryTestGraph([], [policy], new FakeRecoveryInvestigator())
  const mismatchedPlan: RecoveryPlan = { ...approvedPlan, serviceId: 'other-service' }

  assert.throws(
    () => graph.control.restoreDurableState({ incidents: [recoveringIncident], plans: [mismatchedPlan], restartAttempts: [] }),
    /targets unconfigured service|does not match incident/,
  )
})

test('rejectsRestartAttemptForTargetOutsideConfiguredRecoveryPolicy', () => {
  const graph = buildRecoveryTestGraph([], [policy], new FakeRecoveryInvestigator())

  assert.throws(
    () => graph.control.restoreDurableState({
      incidents: [],
      plans: [],
      restartAttempts: [{ nodeId: 'node-a', serviceId: 'unknown', atMs: 1_000 }],
    }),
    /restart attempt\[0\] targets unconfigured service/,
  )
})
