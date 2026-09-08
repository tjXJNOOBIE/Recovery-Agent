import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RecoveryControlConfigReader } from '../../src/config/RecoveryControlConfig.js'
import { RecoveryWatchDefinitionBuilder } from '../../src/control/watch/RecoveryWatchDefinitionBuilder.js'

function writeConfig(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-config-'))
  const path = join(directory, 'control.json')
  writeFileSync(path, JSON.stringify(value))
  return path
}

test('enablesBuiltInServiceWatchAndRollingBudgetWindowByDefault', () => {
  const path = writeConfig({
    nodes: [{
      id: 'node-a',
      baseUrl: 'http://127.0.0.1:7281',
      tokenEnvironmentVariable: 'NODE_TOKEN',
      services: [{ id: 'worker', restartAllowed: true, maxRestartAttempts: 2 }],
    }],
  })

  const config = new RecoveryControlConfigReader().read(path)
  const service = config.nodes[0]?.services[0]
  assert.equal(service?.restartBudgetWindowSeconds, 600)
  assert.equal(service?.watchEnabled, true)
  assert.equal(service?.watchIntervalSeconds, 30)
  assert.deepEqual(service?.dependencies, [])
  assert.deepEqual(new RecoveryWatchDefinitionBuilder().build(config), [
    { nodeId: 'node-a', serviceId: 'worker', intervalMs: 30_000 },
  ])
})

test('allowsServiceWatchBudgetAndDependencyOverrides', () => {
  const path = writeConfig({
    nodes: [{
      id: 'node-a',
      baseUrl: 'http://127.0.0.1:7281',
      tokenEnvironmentVariable: 'NODE_TOKEN',
      services: [
        { id: 'postgres', restartAllowed: true, maxRestartAttempts: 1 },
        {
          id: 'worker',
          restartAllowed: true,
          maxRestartAttempts: 2,
          restartBudgetWindowSeconds: 120,
          watchEnabled: false,
          watchIntervalSeconds: 5,
          dependencies: [{ serviceId: 'postgres' }],
        },
      ],
    }],
  })

  const config = new RecoveryControlConfigReader().read(path)
  const worker = config.nodes[0]?.services[1]
  assert.equal(worker?.restartBudgetWindowSeconds, 120)
  assert.deepEqual(worker?.dependencies, [{ nodeId: 'node-a', serviceId: 'postgres' }])
  assert.deepEqual(new RecoveryWatchDefinitionBuilder().build(config).map((watch) => watch.serviceId), ['postgres'])
})

test('rejectsUnknownDependencyTargetsAndDependencyCycles', () => {
  const missing = writeConfig({
    nodes: [{
      id: 'node-a', baseUrl: 'http://127.0.0.1:1', tokenEnvironmentVariable: 'TOKEN',
      services: [{ id: 'api', restartAllowed: true, maxRestartAttempts: 1, dependencies: [{ serviceId: 'missing' }] }],
    }],
  })
  assert.throws(() => new RecoveryControlConfigReader().read(missing), /unknown dependency node-a\/missing/)

  const cycle = writeConfig({
    nodes: [{
      id: 'node-a', baseUrl: 'http://127.0.0.1:1', tokenEnvironmentVariable: 'TOKEN',
      services: [
        { id: 'a', restartAllowed: true, maxRestartAttempts: 1, dependencies: [{ serviceId: 'b' }] },
        { id: 'b', restartAllowed: true, maxRestartAttempts: 1, dependencies: [{ serviceId: 'a' }] },
      ],
    }],
  })
  assert.throws(() => new RecoveryControlConfigReader().read(cycle), /dependency cycle/)
})
