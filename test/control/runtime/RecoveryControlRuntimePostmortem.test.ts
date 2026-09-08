import assert from 'node:assert/strict'
import test from 'node:test'

import type { IRecoveryPostmortemGenerator, RecoveryPostmortem, RecoveryPostmortemRequest } from '../../../src/control/postmortem/RecoveryPostmortem.js'
import { FakeRecoveryInvestigator } from '../../fake/FakeRecoveryInvestigator.js'
import { buildRecoveryTestGraph } from '../../fake/RecoveryTestGraph.js'

class FakePostmortemGenerator implements IRecoveryPostmortemGenerator {
  public calls = 0
  public lastRequest: RecoveryPostmortemRequest | undefined
  public async generate(request: RecoveryPostmortemRequest): Promise<RecoveryPostmortem> {
    this.calls += 1
    this.lastRequest = request
    return {
      incidentId: request.incident.id,
      summary: 'summary',
      rootCause: 'unknown',
      contributingFactors: [],
      recovery: 'recovered',
      prevention: [],
      confidence: 'low',
    }
  }
}

test('rejectsUnresolvedIncidentBeforePostmortemGeneratorInvocation', async () => {
  const generator = new FakePostmortemGenerator()
  const graph = buildRecoveryTestGraph([], [], new FakeRecoveryInvestigator(), undefined, undefined, undefined, generator)
  const incident = graph.incidents.open('node-a', 'payments', 'unhealthy')

  await assert.rejects(graph.control.generateIncidentPostmortem(incident.id), /postmortem requires resolved/)
  assert.equal(generator.calls, 0)
})

test('passesResolvedIncidentAndOnlyItsRelatedPlansToGenerator', async () => {
  const generator = new FakePostmortemGenerator()
  const graph = buildRecoveryTestGraph([], [], new FakeRecoveryInvestigator(), undefined, undefined, undefined, generator)
  let incident = graph.incidents.open('node-a', 'payments', 'unhealthy')
  incident = graph.incidents.append(incident.id, 'resolved', 'Recovered', 'resolved')
  const related = graph.plans.create({ incidentId: incident.id, nodeId: 'node-a', serviceId: 'payments', rationale: 'related' })
  graph.plans.create({ incidentId: 'other-incident', nodeId: 'node-b', serviceId: 'worker', rationale: 'unrelated' })

  const postmortem = await graph.control.generateIncidentPostmortem(incident.id)
  assert.equal(postmortem.incidentId, incident.id)
  assert.equal(generator.calls, 1)
  assert.equal(generator.lastRequest?.plans.length, 1)
  assert.equal(generator.lastRequest?.plans[0]?.id, related.id)
})
