import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryDemoHandler } from '../../src/demo/RecoveryDemoHandler.js'

test('runsSimulatedFleetThroughRecoveryAndApprovalGateEndToEnd', async () => {
  const result = await new RecoveryDemoHandler().run()
  assert.equal(result.label, 'SIMULATED DEMONSTRATION')
  const sweep = result.sweep as readonly {recovery?: {status: string}}[]
  assert.deepEqual(sweep.map((entry) => entry.recovery?.status).sort(), ['approval_required', 'recovered'])
  const after = result.after as {healthyServices: number; unhealthyServices: number}
  assert.equal(after.healthyServices, 1)
  assert.equal(after.unhealthyServices, 1)
  const watches = result.watches as readonly {lastStatus: string}[]
  assert.deepEqual(watches.map((watch) => watch.lastStatus).sort(), ['approval_required', 'recovered'])
  const incidents = result.incidents as readonly {status: string}[]
  assert.deepEqual(incidents.map((incident) => incident.status).sort(), ['approval_required', 'resolved'])
  const plans = result.plans as readonly {status: string; action: {type: string}}[]
  assert.equal(plans.length, 1)
  assert.equal(plans[0]?.status, 'pending_approval')
  assert.equal(plans[0]?.action.type, 'restart_service')
})
