import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryDemoHandler } from '../../src/demo/RecoveryDemoHandler.js'

test('runsSimulatedFleetThroughRecoveryAndEscalationEndToEnd', async () => {
  const result = await new RecoveryDemoHandler().run()
  assert.equal(result.label, 'SIMULATED DEMONSTRATION')
  const sweep = result.sweep as readonly {status: string}[]
  assert.deepEqual(sweep.map((entry) => entry.status).sort(), ['escalated', 'recovered'])
  const after = result.after as {healthyServices: number; unhealthyServices: number}
  assert.equal(after.healthyServices, 1)
  assert.equal(after.unhealthyServices, 1)
  const incidents = result.incidents as readonly {status: string}[]
  assert.deepEqual(incidents.map((incident) => incident.status).sort(), ['human_required', 'resolved'])
})
