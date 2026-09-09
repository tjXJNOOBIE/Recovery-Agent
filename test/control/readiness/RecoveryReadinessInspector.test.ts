import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAutomaticRestartBudget } from '../../../src/control/budget/RecoveryAutomaticRestartBudget.js'
import type { ServiceRecoveryPolicy } from '../../../src/control/policy/ServiceRecoveryPolicy.js'
import type { ServiceActionResult } from '../../../src/node/data/ServiceActionResult.js'
import type { NodeSnapshot, ServiceSnapshot } from '../../../src/node/data/ServiceSnapshot.js'
import type { INodeAgentGateway } from '../../../src/node/gateway/INodeAgentGateway.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

class ReadinessGateway implements INodeAgentGateway {
  public readonly nodeId: string
  private readonly snapshots: Readonly<Record<string, ServiceSnapshot>>
  private readonly failure: Error | undefined

  public constructor(nodeId: string, snapshots: Readonly<Record<string, ServiceSnapshot>>, failure?: Error) {
    this.nodeId = nodeId
    this.snapshots = snapshots
    this.failure = failure
  }

  public async inspectNode(): Promise<NodeSnapshot> {
    if (this.failure !== undefined) throw this.failure
    return { nodeId: this.nodeId, observedAt: new Date().toISOString(), services: Object.values(this.snapshots) }
  }

  public async inspectService(serviceId: string): Promise<ServiceSnapshot> {
    if (this.failure !== undefined) throw this.failure
    const snapshot = this.snapshots[serviceId]
    if (snapshot === undefined) throw new Error(`missing ${serviceId}`)
    return snapshot
  }

  public async restartService(_serviceId: string): Promise<ServiceActionResult> {
    throw new Error('Readiness test must not mutate')
  }

  public async close(): Promise<void> {}
}

function snapshot(nodeId: string, serviceId: string, healthy: boolean): ServiceSnapshot {
  return {
    nodeId,
    serviceId,
    lifecycleState: 'running',
    healthy,
    detail: healthy ? 'healthy' : 'application probe failed',
    observedAt: '2026-09-08T10:00:00.000Z',
    restartCount: 0,
  }
}

test('reportsRecoveryCapabilityWithoutMutatingTargets', async () => {
  let nowMs = 10_000
  const restartBudget = new RecoveryAutomaticRestartBudget(() => nowMs)
  const readyPolicy: ServiceRecoveryPolicy = {
    nodeId: 'node-a', serviceId: 'ready', expectedState: 'running', restartAllowed: true,
    maxRestartAttempts: 2, restartBudgetWindowMs: 600_000,
  }
  const limitedPolicy: ServiceRecoveryPolicy = {
    nodeId: 'node-a', serviceId: 'limited', expectedState: 'running', restartAllowed: true,
    maxRestartAttempts: 1, restartBudgetWindowMs: 600_000,
  }
  const dependencyPolicy: ServiceRecoveryPolicy = {
    nodeId: 'node-a', serviceId: 'db', expectedState: 'running', restartAllowed: true,
    maxRestartAttempts: 1, restartBudgetWindowMs: 600_000,
  }
  const blockedPolicy: ServiceRecoveryPolicy = {
    nodeId: 'node-a', serviceId: 'api', expectedState: 'running', restartAllowed: true,
    maxRestartAttempts: 1, restartBudgetWindowMs: 600_000,
    dependencies: [{ nodeId: 'node-a', serviceId: 'db' }],
  }
  const unreachablePolicy: ServiceRecoveryPolicy = {
    nodeId: 'node-b', serviceId: 'worker', expectedState: 'running', restartAllowed: true,
    maxRestartAttempts: 1, restartBudgetWindowMs: 600_000,
  }
  restartBudget.tryConsume(limitedPolicy)
  nowMs += 1

  const graph = buildRecoveryTestGraph([
    new ReadinessGateway('node-a', {
      ready: snapshot('node-a', 'ready', true),
      limited: snapshot('node-a', 'limited', true),
      db: snapshot('node-a', 'db', false),
      api: snapshot('node-a', 'api', false),
    }),
    new ReadinessGateway('node-b', {}, new Error('connection refused')),
  ], [readyPolicy, limitedPolicy, dependencyPolicy, blockedPolicy, unreachablePolicy], new FakeRecoveryInvestigator(), undefined, undefined, restartBudget)

  try {
    const report = await graph.control.inspectRecoveryReadiness()
    const byService = new Map(report.services.map((service) => [service.serviceId, service]))

    assert.equal(byService.get('ready')?.status, 'ready')
    assert.equal(byService.get('ready')?.targetHealthy, true)
    assert.equal(byService.get('limited')?.status, 'limited')
    assert.equal(byService.get('limited')?.targetHealthy, true)
    assert.equal(byService.get('limited')?.automaticBudget.remainingAttempts, 0)
    assert.match(byService.get('limited')?.reasons.join(' ') ?? '', /budget is exhausted/)
    assert.equal(byService.get('api')?.status, 'blocked')
    assert.equal(byService.get('api')?.dependencies[0]?.healthy, false)
    assert.equal(byService.get('worker')?.status, 'unreachable')
    assert.equal(report.readyServices, 2)
    assert.equal(report.limitedServices, 1)
    assert.equal(report.blockedServices, 1)
    assert.equal(report.unreachableServices, 1)
    assert.equal(graph.control.listIncidents().length, 0)
  } finally {
    await graph.control.close()
  }
})
