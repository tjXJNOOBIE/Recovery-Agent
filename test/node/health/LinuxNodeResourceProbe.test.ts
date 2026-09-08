import assert from 'node:assert/strict'
import test from 'node:test'

import { LinuxNodeResourceProbe } from '../../../src/node/health/LinuxNodeResourceProbe.js'

test('readsFiniteLinuxResourceEvidenceWithoutShellExecution', async () => {
  const snapshot = await new LinuxNodeResourceProbe().inspect()
  assert.ok(Number.isFinite(snapshot.uptimeSeconds) && snapshot.uptimeSeconds >= 0)
  assert.ok(Number.isFinite(snapshot.loadAverage1mPerCpu) && snapshot.loadAverage1mPerCpu >= 0)
  assert.ok(snapshot.memoryTotalBytes > 0)
  assert.ok(snapshot.memoryUsedPercent >= 0 && snapshot.memoryUsedPercent <= 100)
  assert.ok(snapshot.swapUsedPercent >= 0 && snapshot.swapUsedPercent <= 100)
  assert.ok(snapshot.rootFilesystemTotalBytes > 0)
  assert.ok(snapshot.rootFilesystemUsedPercent >= 0 && snapshot.rootFilesystemUsedPercent <= 100)
})
