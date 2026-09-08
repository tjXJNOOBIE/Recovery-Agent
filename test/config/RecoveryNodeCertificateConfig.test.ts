import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RecoveryNodeConfigReader } from '../../src/config/RecoveryNodeConfig.js'

function writeConfig(value: unknown): { path: string; close(): void } {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-cert-config-'))
  const path = join(directory, 'node.json')
  writeFileSync(path, JSON.stringify(value))
  return { path, close: () => rmSync(directory, { recursive: true, force: true }) }
}

const base = {
  nodeId: 'node-a', tokenEnvironmentVariable: 'NODE_TOKEN',
  services: [{ id: 'web', unit: 'web.service' }],
}

test('parsesFixedCertificateTargetsWithConservativeDefaults', () => {
  const file = writeConfig({ ...base, certificates: [{ id: 'public-tls', host: 'example.com' }] })
  try {
    const config = new RecoveryNodeConfigReader().read(file.path)
    assert.deepEqual(config.certificates[0], {
      id: 'public-tls', host: 'example.com', port: 443, serverName: 'example.com', timeoutMs: 3000,
      warnBeforeDays: 30, criticalBeforeDays: 7,
    })
  } finally { file.close() }
})

test('rejectsDuplicateCertificateIdsAndInvalidThresholdOrdering', () => {
  const duplicates = writeConfig({ ...base, certificates: [{ id: 'tls', host: 'a.test' }, { id: 'tls', host: 'b.test' }] })
  try { assert.throws(() => new RecoveryNodeConfigReader().read(duplicates.path), /certificate IDs must be unique/) } finally { duplicates.close() }

  const thresholds = writeConfig({ ...base, certificates: [{ id: 'tls', host: 'a.test', warnBeforeDays: 7, criticalBeforeDays: 7 }] })
  try { assert.throws(() => new RecoveryNodeConfigReader().read(thresholds.path), /must be less than warnBeforeDays/) } finally { thresholds.close() }
})
