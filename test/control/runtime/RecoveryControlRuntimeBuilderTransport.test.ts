import assert from 'node:assert/strict'
import test from 'node:test'

import type { RecoveryControlConfig } from '../../../src/config/RecoveryControlConfig.js'
import { RecoveryControlRuntimeBuilder } from '../../../src/control/runtime/RecoveryControlRuntimeBuilder.js'
import type { INodeAgentGateway } from '../../../src/node/gateway/INodeAgentGateway.js'
import type { NodeSnapshot, ServiceSnapshot } from '../../../src/node/data/ServiceSnapshot.js'
import type { ServiceActionResult } from '../../../src/node/data/ServiceActionResult.js'
import { FakeStrandsAgentRuntime } from '../../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../../fake/FakeStrandsAgentRuntimeBootstrap.js'

class FakeGateway implements INodeAgentGateway {
  public constructor(public readonly nodeId: string) {}
  public async inspectNode(): Promise<NodeSnapshot> { return { nodeId: this.nodeId, observedAt: new Date(0).toISOString(), services: [] } }
  public async inspectService(serviceId: string): Promise<ServiceSnapshot> { return { nodeId: this.nodeId, serviceId, lifecycleState: 'running', healthy: true, detail: 'ok', observedAt: new Date(0).toISOString(), restartCount: 0 } }
  public async restartService(serviceId: string): Promise<ServiceActionResult> { return { nodeId: this.nodeId, serviceId, action: 'restart', succeeded: true, detail: 'ok', observedAt: new Date(0).toISOString(), service: await this.inspectService(serviceId) } }
  public async close(): Promise<void> {}
}

function outboundConfig(nodeIds: readonly string[]): RecoveryControlConfig {
  return {
    transport: {
      mode: 'outbound_tls', listenHost: '127.0.0.1', listenPort: 9443,
      certificateFile: '/control.crt', privateKeyFile: '/control.key', clientCertificateAuthorityFile: '/ca.crt',
      requestTimeoutMs: 10_000, enrollmentTimeoutMs: 5_000,
    },
    nodes: nodeIds.map((id) => ({
      id,
      allowedCertificateFingerprints: ['a'.repeat(64)],
      services: [{ id: 'worker', restartAllowed: true, maxRestartAttempts: 1, restartBudgetWindowSeconds: 600, watchEnabled: true, watchIntervalSeconds: 30, dependencies: [] }],
    })),
    approvalPrincipals: [],
  }
}

function builder(): RecoveryControlRuntimeBuilder {
  return new RecoveryControlRuntimeBuilder(new FakeStrandsAgentRuntimeBootstrap(new FakeStrandsAgentRuntime('{}')), {})
}

test('outboundTlsRuntimeRequiresExplicitSessionBackedGateways', () => {
  assert.throws(() => builder().build(outboundConfig(['node-a'])), /requires explicit session-backed node gateways/)
})

test('suppliedGatewaysMustExactlyCoverConfiguredNodeIdentities', async () => {
  assert.throws(() => builder().build(outboundConfig(['node-a', 'node-b']), [new FakeGateway('node-a')]), /node-b has no supplied gateway/)
  assert.throws(() => builder().build(outboundConfig(['node-a']), [new FakeGateway('node-a'), new FakeGateway('extra')]), /extra is not present in control config/)
  assert.throws(() => builder().build(outboundConfig(['node-a']), [new FakeGateway('node-a'), new FakeGateway('node-a')]), /Duplicate Recovery node gateway/)

  const runtime = builder().build(outboundConfig(['node-b', 'node-a']), [new FakeGateway('node-a'), new FakeGateway('node-b')])
  assert.deepEqual((await runtime.fleetStatus()).map((node) => node.nodeId), ['node-b', 'node-a'])
  await runtime.close()
})
