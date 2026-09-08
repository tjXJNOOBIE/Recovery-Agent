import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAgentRuntimeConfigBuilder } from '../../../src/agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { RecoveryInvestigationRequest } from '../../../src/control/investigation/IRecoveryInvestigator.js'
import { StrandsRecoveryInvestigator } from '../../../src/control/investigation/StrandsRecoveryInvestigator.js'
import { FakeStrandsAgentRuntime } from '../../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../../fake/FakeStrandsAgentRuntimeBootstrap.js'

const snapshot = {
  nodeId: 'node-a',
  serviceId: 'payments',
  lifecycleState: 'failed' as const,
  healthy: false,
  detail: 'failed/failed; result=exit-code',
  observedAt: '2026-09-07T23:00:00.000Z',
  restartCount: 2,
}

const request: RecoveryInvestigationRequest = {
  incident: {
    id: 'incident-a',
    nodeId: 'node-a',
    serviceId: 'payments',
    openedAt: '2026-09-07T23:00:00.000Z',
    status: 'recovering',
    timeline: [],
  },
  before: snapshot,
  afterAttempts: snapshot,
  attempts: 2,
}

test('delegatesIncidentEvidenceToStrandsAndAlwaysRequiresHumanForCurrentReadOnlyInvestigator', async () => {
  const runtime = new FakeStrandsAgentRuntime('Likely configuration regression.')
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const investigator = new StrandsRecoveryInvestigator(
    bootstrap,
    new RecoveryAgentRuntimeConfigBuilder({}),
  )

  const result = await investigator.investigate(request)

  assert.equal(result.summary, 'Likely configuration regression.')
  assert.equal(result.requiresHuman, true)
  assert.equal(runtime.invokeCalls, 1)
  assert.match(String(runtime.lastInvokeArgs), /incident-a/)
  assert.match(String(runtime.lastInvokeArgs), /Do not claim any mutation/)
  assert.equal(runtime.closeCalls, 1)
})

test('closesStrandsRuntimeWhenInvestigationFails', async () => {
  const runtime = new FakeStrandsAgentRuntime('unused')
  const failure = new Error('provider unavailable')
  runtime.invokeError = failure
  const investigator = new StrandsRecoveryInvestigator(
    new FakeStrandsAgentRuntimeBootstrap(runtime),
    new RecoveryAgentRuntimeConfigBuilder({}),
  )

  await assert.rejects(investigator.investigate(request), failure)
  assert.equal(runtime.closeCalls, 1)
})
