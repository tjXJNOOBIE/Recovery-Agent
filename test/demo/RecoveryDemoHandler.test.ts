import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryDemoHandler } from '../../src/demo/RecoveryDemoHandler.js'

test('runsSimulatedFleetThroughRecoveryAndApprovalGateEndToEnd', async () => {
  const result = await new RecoveryDemoHandler().run()
  assert.equal(result.label, 'SIMULATED DEMONSTRATION')

  const sweep = result.sweep as {
    readonly services: readonly { recovery?: { status: string } }[]
    readonly nodes: readonly { state: { lastStatus: string } }[]
  }
  assert.deepEqual(
    sweep.services.map((entry) => entry.recovery?.status).sort(),
    ['approval_required', 'recovered'],
  )
  assert.deepEqual(sweep.nodes.map((entry) => entry.state.lastStatus), ['healthy'])

  const after = result.after as { healthyServices: number; unhealthyServices: number }
  assert.equal(after.healthyServices, 1)
  assert.equal(after.unhealthyServices, 1)

  const watches = result.watches as {
    readonly services: readonly { lastStatus: string }[]
    readonly nodes: readonly { lastStatus: string }[]
  }
  assert.deepEqual(
    watches.services.map((watch) => watch.lastStatus).sort(),
    ['approval_required', 'recovered'],
  )
  assert.deepEqual(watches.nodes.map((watch) => watch.lastStatus), ['healthy'])

  const incidents = result.incidents as readonly { status: string }[]
  assert.deepEqual(incidents.map((incident) => incident.status).sort(), ['approval_required', 'resolved'])

  const plans = result.plans as readonly { status: string; action: { type: string } }[]
  assert.equal(plans.length, 1)
  assert.equal(plans[0]?.status, 'pending_approval')
  assert.equal(plans[0]?.action.type, 'restart_service')
})
