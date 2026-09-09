import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryPlanReviewParser } from '../../../src/control/plan/RecoveryPlanReviewParser.js'

test('acceptsOnlyVetoStylePlanReviewShape', () => {
  const parser = new RecoveryPlanReviewParser()
  assert.deepEqual(parser.parse('{"accepted":false,"concerns":["Causality is weak"]}'), { accepted: false, concerns: ['Causality is weak'] })
  assert.throws(() => parser.parse('{"accepted":true,"concerns":[],"action":"reboot_node"}'), /only accepted and concerns/)
  assert.throws(() => parser.parse('{"accepted":true,"concerns":["a","b","c","d","e","f"]}'), /at most five/)
})
