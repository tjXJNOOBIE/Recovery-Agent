import assert from 'node:assert/strict'
import test from 'node:test'

import type { IServiceHealthProbe, ServiceHealthCheckDefinition, ServiceHealthCheckResult } from '../../../src/node/health/ServiceHealthCheck.js'
import type { CommandResult, ICommandExecutor } from '../../../src/node/systemd/SystemdNodeServiceRuntime.js'
import { SystemdNodeServiceRuntime } from '../../../src/node/systemd/SystemdNodeServiceRuntime.js'

class FakeCommandExecutor implements ICommandExecutor {
  public responses: CommandResult[] = []

  public async execute(_command: string, _args: readonly string[]): Promise<CommandResult> {
    const response = this.responses.shift()
    if (response === undefined) throw new Error('Missing fake command response')
    return response
  }
}

class FakeHealthProbe implements IServiceHealthProbe {
  public calls = 0
  public results: ServiceHealthCheckResult[] = []

  public async check(_definition: ServiceHealthCheckDefinition): Promise<ServiceHealthCheckResult> {
    this.calls += 1
    const result = this.results.shift()
    if (result === undefined) throw new Error('Missing fake health result')
    return result
  }
}

test('activeSystemdUnitIsUnhealthyWhenConfiguredApplicationProbeFails', async () => {
  const executor = new FakeCommandExecutor()
  executor.responses.push({
    exitCode: 0,
    stdout: 'ActiveState=active\nSubState=running\nResult=success\nNRestarts=2\n',
    stderr: '',
  })
  const probe = new FakeHealthProbe()
  probe.results.push({
    type: 'http',
    target: 'http://127.0.0.1:8080/health',
    healthy: false,
    detail: 'HTTP 500; expected 200',
    observedAt: '2026-09-08T09:00:00.000Z',
    latencyMs: 3,
    statusCode: 500,
  })
  const runtime = new SystemdNodeServiceRuntime(
    'node-a',
    [{
      id: 'payments',
      unit: 'payments.service',
      healthChecks: [{
        type: 'http',
        url: 'http://127.0.0.1:8080/health',
        timeoutMs: 1000,
        expectedStatusCodes: [200],
      }],
    }],
    executor,
    probe,
  )

  const snapshot = await runtime.inspectService('payments')

  assert.equal(snapshot.lifecycleState, 'running')
  assert.equal(snapshot.healthy, false)
  assert.equal(snapshot.healthChecks?.[0]?.statusCode, 500)
  assert.match(snapshot.detail, /http:unhealthy/)
  assert.equal(probe.calls, 1)
})

test('doesNotProbeApplicationEndpointWhenSystemdUnitIsNotRunning', async () => {
  const executor = new FakeCommandExecutor()
  executor.responses.push({
    exitCode: 0,
    stdout: 'ActiveState=failed\nSubState=failed\nResult=exit-code\nNRestarts=4\n',
    stderr: '',
  })
  const probe = new FakeHealthProbe()
  const runtime = new SystemdNodeServiceRuntime(
    'node-a',
    [{
      id: 'payments',
      unit: 'payments.service',
      healthChecks: [{ type: 'tcp', host: '127.0.0.1', port: 8080, timeoutMs: 1000 }],
    }],
    executor,
    probe,
  )

  const snapshot = await runtime.inspectService('payments')

  assert.equal(snapshot.healthy, false)
  assert.equal(snapshot.lifecycleState, 'failed')
  assert.equal(snapshot.healthChecks, undefined)
  assert.equal(probe.calls, 0)
})
