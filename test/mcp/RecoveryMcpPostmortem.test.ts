import assert from 'node:assert/strict'
import test from 'node:test'

import type { RecoveryWatchSurface } from '../../src/control/watch/RecoveryWatchSurface.js'
import { RecoveryMcpToolRouter } from '../../src/mcp/RecoveryMcpToolRouter.js'
import { FakeRecoveryInvestigator } from '../fake/FakeRecoveryInvestigator.js'
import { buildRecoveryTestGraph } from '../fake/RecoveryTestGraph.js'

const watches: RecoveryWatchSurface = {
  listStates: () => ({}),
  runAllNow: async () => ({}),
}

test('exposesReadOnlyPostmortemIntentAndRoutesResolvedIncidentOnly', async () => {
  const graph = buildRecoveryTestGraph([], [], new FakeRecoveryInvestigator())
  const router = new RecoveryMcpToolRouter(graph.control, watches)
  assert.ok(router.listTools().some((tool) => tool.name === 'incident_postmortem'))

  const incident = graph.incidents.open('node-a', 'payments', 'unhealthy')
  await assert.rejects(router.callTool('incident_postmortem', { incidentId: incident.id }), /postmortem requires resolved/)
})
