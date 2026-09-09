import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RecoveryNodeConfigReader } from '../../src/config/RecoveryNodeConfig.js'

function writeConfig(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-node-config-'))
  const path = join(directory, 'node.json')
  writeFileSync(path, JSON.stringify(value))
  return path
}

test('parsesTypedHttpAndTcpHealthChecksWithSafeDefaults', () => {
  const config = new RecoveryNodeConfigReader().read(writeConfig({
    nodeId: 'node-a',
    tokenEnvironmentVariable: 'NODE_TOKEN',
    services: [{
      id: 'payments',
      unit: 'payments.service',
      healthChecks: [
        { type: 'http', url: 'http://127.0.0.1:8080/health' },
        { type: 'tcp', host: '127.0.0.1', port: 8080, timeoutMs: 1500 },
      ],
    }],
  }))

  assert.deepEqual(config.services[0]?.healthChecks, [
    {
      type: 'http',
      url: 'http://127.0.0.1:8080/health',
      timeoutMs: 2000,
      expectedStatusCodes: [200],
    },
    {
      type: 'tcp',
      host: '127.0.0.1',
      port: 8080,
      timeoutMs: 1500,
    },
  ])
})

test('rejectsUnsafeOrInvalidConfiguredHealthTargets', () => {
  const reader = new RecoveryNodeConfigReader()
  assert.throws(
    () => reader.read(writeConfig({
      nodeId: 'node-a',
      tokenEnvironmentVariable: 'NODE_TOKEN',
      services: [{
        id: 'payments',
        unit: 'payments.service',
        healthChecks: [{ type: 'http', url: 'http://user:secret@127.0.0.1/health' }],
      }],
    })),
    /must not contain embedded credentials/,
  )
  assert.throws(
    () => reader.read(writeConfig({
      nodeId: 'node-a',
      tokenEnvironmentVariable: 'NODE_TOKEN',
      services: [{
        id: 'payments',
        unit: 'payments.service',
        healthChecks: [{ type: 'tcp', host: '127.0.0.1', port: 70000 }],
      }],
    })),
    /TCP port from 1 through 65535/,
  )
})
