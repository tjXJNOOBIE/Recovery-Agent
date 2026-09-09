import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryTriageParser } from '../../../src/control/investigation/RecoveryTriage.js'

test('acceptsOnlyBoundedUniqueKnownSpecialistDomains', () => {
  const parser = new RecoveryTriageParser()
  assert.deepEqual(parser.parse('{"severity":"high","domains":["service","deployment"],"hypothesis":"Regression"}'), { severity: 'high', domains: ['service', 'deployment'], hypothesis: 'Regression' })
  assert.throws(() => parser.parse('{"severity":"high","domains":["service","service"],"hypothesis":"x"}'), /must not contain duplicates/)
  assert.throws(() => parser.parse('{"severity":"high","domains":["service","deployment","node","network"],"hypothesis":"x"}'), /one through three/)
  assert.throws(() => parser.parse('{"severity":"high","domains":["shell"],"hypothesis":"x"}'), /domain is invalid/)
})
