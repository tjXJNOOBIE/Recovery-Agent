import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RecoveryControlConfigReader } from '../../src/config/RecoveryControlConfig.js'
import { RecoveryWatchDefinitionBuilder } from '../../src/control/watch/RecoveryWatchDefinitionBuilder.js'

test('enablesBuiltInServiceWatchByDefaultAndBuildsItsInterval', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-config-'))
  const path = join(directory, 'control.json')
  writeFileSync(path, JSON.stringify({
    nodes: [{
      id: 'node-a',
      baseUrl: 'http://127.0.0.1:7281',
      tokenEnvironmentVariable: 'NODE_TOKEN',
      services: [{ id: 'worker', restartAllowed: true, maxRestartAttempts: 2 }],
    }],
  }))

  const config = new RecoveryControlConfigReader().read(path)
  const service = config.nodes[0]?.services[0]
  assert.equal(service?.watchEnabled, true)
  assert.equal(service?.watchIntervalSeconds, 30)
  assert.deepEqual(new RecoveryWatchDefinitionBuilder().build(config), [
    { nodeId: 'node-a', serviceId: 'worker', intervalMs: 30_000 },
  ])
})

test('allowsAServiceWatchToBeDisabledExplicitly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-config-'))
  const path = join(directory, 'control.json')
  writeFileSync(path, JSON.stringify({
    nodes: [{
      id: 'node-a',
      baseUrl: 'http://127.0.0.1:7281',
      tokenEnvironmentVariable: 'NODE_TOKEN',
      services: [{
        id: 'worker',
        restartAllowed: true,
        maxRestartAttempts: 2,
        watchEnabled: false,
        watchIntervalSeconds: 5,
      }],
    }],
  }))

  const config = new RecoveryControlConfigReader().read(path)
  assert.deepEqual(new RecoveryWatchDefinitionBuilder().build(config), [])
})
