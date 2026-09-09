import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAgentRuntimeConfigBuilder } from '../../../../src/agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoverySemanticWatchParser } from '../../../../src/control/watch/semantic/RecoverySemanticWatchParser.js'
import { StrandsRecoverySemanticWatchCompiler } from '../../../../src/control/watch/semantic/StrandsRecoverySemanticWatchCompiler.js'
import { FakeStrandsAgentRuntime } from '../../../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../../../fake/FakeStrandsAgentRuntimeBootstrap.js'

const targets = [{ nodeId: 'east', serviceId: 'payments' }] as const

test('compilesOperatorIntentOnceThroughStrandsAndClosesRuntime', async () => {
  const runtime = new FakeStrandsAgentRuntime(JSON.stringify({
    nodeId: 'east', serviceId: 'payments', intervalSeconds: 120, rationale: 'Two-minute recovery watch.',
  }))
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const compiler = new StrandsRecoverySemanticWatchCompiler(
    bootstrap,
    new RecoveryAgentRuntimeConfigBuilder({}),
    targets,
    new RecoverySemanticWatchParser(targets),
  )

  const result = await compiler.compile('Watch payments every two minutes')
  assert.equal(result.intervalSeconds, 120)
  assert.equal(bootstrap.createCalls, 1)
  assert.equal(runtime.invokeCalls, 1)
  assert.equal(runtime.closeCalls, 1)
  assert.match(String(runtime.lastInvokeArgs), /Configured targets/)
  assert.match(String(runtime.lastInvokeArgs), /Do not create URLs, commands/)
})

test('closesStrandsRuntimeWhenSemanticCompilationFailsValidation', async () => {
  const runtime = new FakeStrandsAgentRuntime(JSON.stringify({
    nodeId: 'invented', serviceId: 'payments', intervalSeconds: 120, rationale: 'bad target',
  }))
  const compiler = new StrandsRecoverySemanticWatchCompiler(
    new FakeStrandsAgentRuntimeBootstrap(runtime),
    new RecoveryAgentRuntimeConfigBuilder({}),
    targets,
    new RecoverySemanticWatchParser(targets),
  )

  await assert.rejects(compiler.compile('Watch a made-up node'), /target is not configured/)
  assert.equal(runtime.closeCalls, 1)
})

test('preservesCompilationFailureWhenRuntimeCleanupAlsoFails', async () => {
  const runtime = new FakeStrandsAgentRuntime(JSON.stringify({
    nodeId: 'invented', serviceId: 'payments', intervalSeconds: 120, rationale: 'bad target',
  }))
  const cleanupError = new Error('runtime close failed')
  runtime.closeError = cleanupError
  const compiler = new StrandsRecoverySemanticWatchCompiler(
    new FakeStrandsAgentRuntimeBootstrap(runtime),
    new RecoveryAgentRuntimeConfigBuilder({}),
    targets,
    new RecoverySemanticWatchParser(targets),
  )

  await assert.rejects(
    compiler.compile('Watch a made-up node'),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors.length, 2)
      assert.match(String(error.errors[0]), /target is not configured/)
      assert.equal(error.errors[1], cleanupError)
      return true
    },
  )
  assert.equal(runtime.closeCalls, 1)
})
