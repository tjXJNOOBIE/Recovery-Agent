import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { FileDeploymentEvidenceProbe } from '../../../src/node/deployment/FileDeploymentEvidenceProbe.js'

test('hashesDeploymentMarkerWithoutExposingMarkerContents', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-deployment-marker-'))
  const markerFile = join(directory, 'deployment.marker')
  try {
    writeFileSync(markerFile, 'release-secret-looking-value')
    const probe = new FileDeploymentEvidenceProbe()
    const first = await probe.inspect(markerFile)
    assert.equal(first.available, true)
    assert.match(first.marker ?? '', /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(first).includes('release-secret-looking-value'), false)

    await new Promise((resolve) => setTimeout(resolve, 5))
    writeFileSync(markerFile, 'release-two')
    const second = await probe.inspect(markerFile)
    assert.equal(second.available, true)
    assert.notEqual(second.marker, first.marker)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('reportsUnavailableEvidenceForMissingMarkerWithoutThrowing', async () => {
  const result = await new FileDeploymentEvidenceProbe().inspect('/definitely/not/a/recovery-agent-marker')
  assert.equal(result.available, false)
  assert.ok(result.error)
})
