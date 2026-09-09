import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryPostmortemParser } from '../../../src/control/postmortem/RecoveryPostmortemParser.js'

test('parsesStrictEvidenceBoundPostmortemShapeAndInjectsIncidentIdDeterministically', () => {
  const parser = new RecoveryPostmortemParser()
  const result = parser.parse('incident-a', JSON.stringify({
    summary: 'Payments failed after deployment.',
    rootCause: 'Configuration regression.',
    contributingFactors: ['Probe failed after restart.'],
    recovery: 'Service recovered after rollback by operator.',
    prevention: ['Add config validation.'],
    confidence: 'high',
  }))
  assert.equal(result.incidentId, 'incident-a')
  assert.equal(result.confidence, 'high')
  assert.deepEqual(result.prevention, ['Add config validation.'])
})

test('rejectsExtraFieldsAndInvalidConfidence', () => {
  const parser = new RecoveryPostmortemParser()
  assert.throws(() => parser.parse('incident-a', JSON.stringify({
    summary: 'x', rootCause: 'unknown', contributingFactors: [], recovery: 'x', prevention: [], confidence: 'high', operator: 'invented',
  })), /unexpected or missing fields/)
  assert.throws(() => parser.parse('incident-a', JSON.stringify({
    summary: 'x', rootCause: 'unknown', contributingFactors: [], recovery: 'x', prevention: [], confidence: 'certain',
  })), /confidence must be low, medium, or high/)
})
