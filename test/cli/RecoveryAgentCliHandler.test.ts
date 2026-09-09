import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAgentRuntimeConfigBuilder } from '../../src/agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RecoveryAgentCliHandler } from '../../src/cli/RecoveryAgentCliHandler.js'
import { RecoveryAgentCliInputError } from '../../src/cli/error/RecoveryAgentCliInputError.js'
import { FakeStrandsAgentRuntime } from '../fake/FakeStrandsAgentRuntime.js'
import { FakeStrandsAgentRuntimeBootstrap } from '../fake/FakeStrandsAgentRuntimeBootstrap.js'

test('rejectsBlankRequestBeforeCreatingRuntime', async () => {
  const runtime = new FakeStrandsAgentRuntime('unused')
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const handler = new RecoveryAgentCliHandler(bootstrap, new RecoveryAgentRuntimeConfigBuilder({}))

  await assert.rejects(handler.handle('   '), RecoveryAgentCliInputError)
  assert.equal(bootstrap.createCalls, 0)
})

test('delegatesNormalizedRequestAndClosesRuntime', async () => {
  const runtime = new FakeStrandsAgentRuntime('complete')
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const handler = new RecoveryAgentCliHandler(bootstrap, new RecoveryAgentRuntimeConfigBuilder({}))

  const result = await handler.handle('  do the work  ')

  assert.equal(result, 'complete')
  assert.equal(bootstrap.createCalls, 1)
  assert.equal(runtime.invokeCalls, 1)
  assert.equal(runtime.lastInvokeArgs, 'do the work')
  assert.equal(runtime.closeCalls, 1)
  assert.equal(runtime.isClosed(), true)
})

test('closesRuntimeWhenInvocationFails', async () => {
  const runtime = new FakeStrandsAgentRuntime('unused')
  const invocationError = new Error('model failed')
  runtime.invokeError = invocationError
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const handler = new RecoveryAgentCliHandler(bootstrap, new RecoveryAgentRuntimeConfigBuilder({}))

  await assert.rejects(handler.handle('do the work'), invocationError)
  assert.equal(runtime.closeCalls, 1)
})

test('aggregatesInvocationAndCleanupFailuresWithoutLosingPrimaryError', async () => {
  const runtime = new FakeStrandsAgentRuntime('unused')
  const invocationError = new Error('model failed')
  const cleanupError = new Error('runtime close failed')
  runtime.invokeError = invocationError
  runtime.closeError = cleanupError
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const handler = new RecoveryAgentCliHandler(bootstrap, new RecoveryAgentRuntimeConfigBuilder({}))

  await assert.rejects(
    handler.handle('do the work'),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [invocationError, cleanupError])
      assert.equal(error.cause, invocationError)
      return true
    },
  )
  assert.equal(runtime.closeCalls, 1)
})

test('preservesUndefinedInvocationRejectionWhenCleanupAlsoFails', async () => {
  const runtime = new FakeStrandsAgentRuntime('unused')
  const cleanupError = new Error('runtime close failed')
  runtime.failInvokeWith(undefined)
  runtime.closeError = cleanupError
  const handler = new RecoveryAgentCliHandler(
    new FakeStrandsAgentRuntimeBootstrap(runtime),
    new RecoveryAgentRuntimeConfigBuilder({}),
  )

  await assert.rejects(
    handler.handle('do the work'),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [undefined, cleanupError])
      return true
    },
  )
})

test('surfacesCleanupFailureWhenInvocationSucceeds', async () => {
  const runtime = new FakeStrandsAgentRuntime('complete')
  const cleanupError = new Error('runtime close failed')
  runtime.closeError = cleanupError
  const bootstrap = new FakeStrandsAgentRuntimeBootstrap(runtime)
  const handler = new RecoveryAgentCliHandler(bootstrap, new RecoveryAgentRuntimeConfigBuilder({}))

  await assert.rejects(handler.handle('do the work'), cleanupError)
  assert.equal(runtime.invokeCalls, 1)
  assert.equal(runtime.closeCalls, 1)
})
