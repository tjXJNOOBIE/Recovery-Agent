import assert from 'node:assert/strict'
import test from 'node:test'

import type { CommandResult, ICommandExecutor } from '../../../src/node/systemd/SystemdNodeServiceRuntime.js'
import { SystemdNodeServiceRuntime } from '../../../src/node/systemd/SystemdNodeServiceRuntime.js'

class FakeCommandExecutor implements ICommandExecutor {
  public readonly calls: { command: string; args: readonly string[] }[] = []
  public responses: CommandResult[] = []

  public async execute(command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push({ command, args: [...args] })
    const response = this.responses.shift()
    if (response === undefined) throw new Error('Missing fake command response')
    return response
  }
}

test('mapsPublicServiceIdToConfiguredSystemdUnitWithoutAcceptingShellInput', async () => {
  const executor = new FakeCommandExecutor()
  executor.responses.push({
    exitCode: 0,
    stdout: 'ActiveState=active\nSubState=running\nResult=success\nNRestarts=3\n',
    stderr: '',
  })
  const runtime = new SystemdNodeServiceRuntime(
    'node-a',
    [{ id: 'payments', unit: 'payments-api.service' }],
    executor,
  )

  const snapshot = await runtime.inspectService('payments')

  assert.equal(snapshot.lifecycleState, 'running')
  assert.equal(snapshot.healthy, true)
  assert.equal(snapshot.restartCount, 3)
  assert.deepEqual(executor.calls[0], {
    command: 'systemctl',
    args: [
      'show',
      'payments-api.service',
      '--no-pager',
      '--property=ActiveState',
      '--property=SubState',
      '--property=Result',
      '--property=NRestarts',
    ],
  })
})

test('restartUsesConfiguredUnitThenInspectsFreshState', async () => {
  const executor = new FakeCommandExecutor()
  executor.responses.push(
    { exitCode: 0, stdout: '', stderr: '' },
    {
      exitCode: 0,
      stdout: 'ActiveState=active\nSubState=running\nResult=success\nNRestarts=1\n',
      stderr: '',
    },
  )
  const runtime = new SystemdNodeServiceRuntime(
    'node-a',
    [{ id: 'worker', unit: 'worker.service' }],
    executor,
  )

  const result = await runtime.restartService('worker')

  assert.equal(result.accepted, true)
  assert.equal(result.snapshot.healthy, true)
  assert.deepEqual(executor.calls[0], {
    command: 'systemctl',
    args: ['restart', 'worker.service'],
  })
  assert.equal(executor.calls[1]?.command, 'systemctl')
})

test('rejectsUnknownServiceBeforeExecutingSystemctl', async () => {
  const executor = new FakeCommandExecutor()
  const runtime = new SystemdNodeServiceRuntime('node-a', [], executor)

  await assert.rejects(runtime.restartService('not-configured'), /not configured/)
  assert.equal(executor.calls.length, 0)
})
