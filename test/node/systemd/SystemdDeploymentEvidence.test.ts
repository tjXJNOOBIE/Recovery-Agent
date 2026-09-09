import assert from 'node:assert/strict'
import test from 'node:test'

import type { DeploymentEvidence, IDeploymentEvidenceProbe } from '../../../src/node/deployment/DeploymentEvidence.js'
import type { CommandResult, ICommandExecutor } from '../../../src/node/systemd/SystemdNodeServiceRuntime.js'
import { SystemdNodeServiceRuntime } from '../../../src/node/systemd/SystemdNodeServiceRuntime.js'

class FakeCommandExecutor implements ICommandExecutor {
  public async execute(_command: string, _args: readonly string[]): Promise<CommandResult> {
    return { exitCode: 0, stdout: 'ActiveState=active\nSubState=running\nResult=success\nNRestarts=0\n', stderr: '' }
  }
}
class FakeDeploymentProbe implements IDeploymentEvidenceProbe {
  public async inspect(markerFile: string): Promise<DeploymentEvidence> {
    assert.equal(markerFile, '/opt/app/deployment.marker')
    return { observedAt: '2026-09-08T00:00:00.000Z', available: true, marker: 'abc', deployedAt: '2026-09-08T00:00:00.000Z' }
  }
}

test('attachesDeploymentEvidenceWithoutChangingHealthyServiceDecision', async () => {
  const runtime = new SystemdNodeServiceRuntime('node-a', [{ id: 'web', unit: 'web.service', deploymentMarkerFile: '/opt/app/deployment.marker' }], new FakeCommandExecutor(), undefined, new FakeDeploymentProbe())
  const snapshot = await runtime.inspectService('web')
  assert.equal(snapshot.healthy, true)
  assert.equal(snapshot.deployment?.marker, 'abc')
})
