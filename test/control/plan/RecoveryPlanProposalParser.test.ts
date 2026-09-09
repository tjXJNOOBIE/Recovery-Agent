import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryPlanProposalParser } from '../../../src/control/plan/RecoveryPlanProposalParser.js'

const parser = new RecoveryPlanProposalParser()

test('acceptsOnlyTheBoundedRecoveryProposalShape', () => {
  const result = parser.parse('{"action":"restart_service","rationale":"One approved restart is evidence-supported."}')
  assert.deepEqual(result, {
    action: 'restart_service',
    rationale: 'One approved restart is evidence-supported.',
  })
})

test('rejectsTargetOrCommandInjectionFieldsFromModelOutput', () => {
  assert.throws(
    () => parser.parse('{"action":"restart_service","rationale":"try again","nodeId":"other-node","command":"rm -rf /"}'),
    /may contain only action and rationale/,
  )
})

test('rejectsMarkdownOrNonJsonModelOutputInsteadOfGuessing', () => {
  assert.throws(
    () => parser.parse('```json\n{"action":"none","rationale":"No action"}\n```'),
    /strict JSON without markdown fencing/,
  )
})
