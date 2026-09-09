import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAgentRuntimeConfigBuilder } from '../../../src/agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryPostmortemParser } from '../../../src/control/postmortem/RecoveryPostmortemParser.js'
import { StrandsRecoveryPostmortem } from '../../../src/control/postmortem/StrandsRecoveryPostmortem.js'
import { FakeStrandsAgentRuntime } from '../../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../../fake/FakeStrandsAgentRuntimeBootstrap.js'

const resolvedIncident = {
  id: 'incident-a', nodeId: 'node-a', serviceId: 'payments', openedAt: '2026-09-08T00:00:00.000Z', status: 'resolved' as const,
  timeline: [{ at: '2026-09-08T00:01:00.000Z', kind: 'resolved' as const, message: 'Recovered' }],
}

test('generatesStrictPostmortemAndAlwaysClosesStrandsRuntime', async () => {
  const runtime = new FakeStrandsAgentRuntime(JSON.stringify({
    summary: 'Recovered incident.', rootCause: 'unknown', contributingFactors: ['Restart budget exhausted.'],
    recovery: 'Operator restored service.', prevention: ['Collect more deployment evidence.'], confidence: 'medium',
  }))
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const generator = new StrandsRecoveryPostmortem(bootstrap, new RecoveryAgentRuntimeConfigBuilder({}), new RecoveryPostmortemParser())
  const result = await generator.generate({ incident: resolvedIncident, plans: [] })
  assert.equal(result.incidentId, 'incident-a')
  assert.equal(result.rootCause, 'unknown')
  assert.match(String(runtime.lastInvokeArgs), /Do not invent actions, deployments, people, or outcomes/i)
  assert.equal(runtime.closeCalls, 1)
})

test('rejectsUnresolvedIncidentBeforeCreatingStrandsRuntime', async () => {
  const runtime = new FakeStrandsAgentRuntime('unused')
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const generator = new StrandsRecoveryPostmortem(bootstrap, new RecoveryAgentRuntimeConfigBuilder({}), new RecoveryPostmortemParser())
  await assert.rejects(generator.generate({ incident: { ...resolvedIncident, status: 'human_required' }, plans: [] }), /requires a resolved incident/)
  assert.equal(bootstrap.createCalls, 0)
  assert.equal(runtime.invokeCalls, 0)
})
