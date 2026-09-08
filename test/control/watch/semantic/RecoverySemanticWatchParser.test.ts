import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_SEMANTIC_WATCH_INTERVAL_SECONDS,
  MIN_SEMANTIC_WATCH_INTERVAL_SECONDS,
  RecoverySemanticWatchParser,
} from '../../../../src/control/watch/semantic/RecoverySemanticWatchParser.js'

const parser = new RecoverySemanticWatchParser([
  { nodeId: 'east', serviceId: 'payments' },
  { nodeId: 'west', serviceId: 'worker' },
])

test('parsesOnlyConfiguredBoundedSemanticWatchTargets', () => {
  assert.deepEqual(parser.parse(JSON.stringify({
    nodeId: 'east',
    serviceId: 'payments',
    intervalSeconds: 120,
    rationale: 'Operator requested tighter payments monitoring.',
  })), {
    nodeId: 'east',
    serviceId: 'payments',
    intervalSeconds: 120,
    rationale: 'Operator requested tighter payments monitoring.',
  })

  assert.throws(() => parser.parse(JSON.stringify({
    nodeId: 'unknown',
    serviceId: 'payments',
    intervalSeconds: 120,
    rationale: 'not configured',
  })), /target is not configured/)

  assert.throws(() => parser.parse(JSON.stringify({
    nodeId: 'east',
    serviceId: 'payments',
    intervalSeconds: 120,
    rationale: 'tries to add a URL',
    url: 'http:\/\/169.254.169.254',
  })), /may contain only/)
})

test('rejectsSemanticWatchIntervalsOutsideDeterministicBounds', () => {
  for (const intervalSeconds of [MIN_SEMANTIC_WATCH_INTERVAL_SECONDS - 1, MAX_SEMANTIC_WATCH_INTERVAL_SECONDS + 1]) {
    assert.throws(() => parser.parse(JSON.stringify({
      nodeId: 'east',
      serviceId: 'payments',
      intervalSeconds,
      rationale: 'invalid interval',
    })), /intervalSeconds must be an integer/)
  }
})
