import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAgentRuntimeConfigBuilder } from '../../../src/agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { RecoveryInvestigationRequest } from '../../../src/control/investigation/IRecoveryInvestigator.js'
import { StrandsRecoveryInvestigator } from '../../../src/control/investigation/StrandsRecoveryInvestigator.js'
import { FakeStrandsAgentRuntime } from '../../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../../fake/FakeStrandsAgentRuntimeBootstrap.js'

const snapshot = { nodeId: 'node-a', serviceId: 'payments', lifecycleState: 'failed' as const, healthy: false, detail: 'failed/failed; result=exit-code', observedAt: '2026-09-07T23:00:00.000Z', restartCount: 2 }
const request: RecoveryInvestigationRequest = { incident: { id: 'incident-a', nodeId: 'node-a', serviceId: 'payments', openedAt: '2026-09-07T23:00:00.000Z', status: 'recovering', timeline: [] }, before: snapshot, afterAttempts: snapshot, attempts: 2 }

test('runsBoundedTriageSpecialistsAndSynthesisInOneStrandsRuntime', async () => {
  const runtime = new FakeStrandsAgentRuntime([
    '{"severity":"high","domains":["service","deployment"],"hypothesis":"Possible deployment regression"}',
    'Service remains failed after restart.',
    'Deployment marker changed immediately before failure.',
    'Likely deployment regression; service remained unhealthy after restart.',
  ])
  const investigator = new StrandsRecoveryInvestigator(new FakeStrandsAgentRuntimeBootstrap(runtime), new RecoveryAgentRuntimeConfigBuilder({}))
  const result = await investigator.investigate(request)
  assert.match(result.summary, /deployment regression/i)
  assert.equal(result.requiresHuman, true)
  assert.equal(runtime.invokeCalls, 4)
  assert.match(String(runtime.invokeHistory[0]), /one through three unique domains/i)
  assert.match(String(runtime.invokeHistory[1]), /service recovery specialist/i)
  assert.match(String(runtime.invokeHistory[2]), /deployment recovery specialist/i)
  assert.match(String(runtime.invokeHistory[3]), /Synthesize the recovery investigation/i)
  assert.equal(runtime.closeCalls, 1)
})

test('fallsBackToServiceSpecialistWhenStructuredTriageIsMalformed', async () => {
  const runtime = new FakeStrandsAgentRuntime(['not-json', 'Service finding', 'Fallback synthesis'])
  const investigator = new StrandsRecoveryInvestigator(new FakeStrandsAgentRuntimeBootstrap(runtime), new RecoveryAgentRuntimeConfigBuilder({}))
  const result = await investigator.investigate(request)
  assert.equal(result.summary, 'Fallback synthesis')
  assert.equal(runtime.invokeCalls, 3)
  assert.match(String(runtime.invokeHistory[1]), /service recovery specialist/i)
  assert.equal(runtime.closeCalls, 1)
})

test('closesStrandsRuntimeWhenInvestigationFails', async () => {
  const runtime = new FakeStrandsAgentRuntime('unused'); const failure = new Error('provider unavailable'); runtime.invokeError = failure
  const investigator = new StrandsRecoveryInvestigator(new FakeStrandsAgentRuntimeBootstrap(runtime), new RecoveryAgentRuntimeConfigBuilder({}))
  await assert.rejects(investigator.investigate(request), failure)
  assert.equal(runtime.closeCalls, 1)
})
