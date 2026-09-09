import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryMcpShutdownHandler } from '../../src/cli/RecoveryMcpShutdownHandler.js'

function closeable(name: string, order: string[], error?: unknown): { close(): Promise<void> } {
  return {
    close: async () => {
      order.push(name)
      if (error !== undefined) throw error
    },
  }
}

test('attemptsEveryMcpCleanupInOrderAfterEarlierFailure', async () => {
  const order: string[] = []
  const mcpError = new Error('mcp close failed')
  const controlError = new Error('control close failed')
  const handler = new RecoveryMcpShutdownHandler()

  await assert.rejects(
    handler.close({
      mcpServer: closeable('mcp', order, mcpError),
      watches: closeable('watches', order),
      approvalServer: closeable('approval', order),
      control: closeable('control', order, controlError),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [mcpError, controlError])
      assert.equal(error.cause, mcpError)
      return true
    },
  )

  assert.deepEqual(order, ['mcp', 'watches', 'approval', 'control'])
})

test('surfacesSingleShutdownFailureAfterAttemptingRemainingResources', async () => {
  const order: string[] = []
  const watchesError = new Error('watch close failed')
  const handler = new RecoveryMcpShutdownHandler()

  await assert.rejects(
    handler.close({
      mcpServer: closeable('mcp', order),
      watches: closeable('watches', order, watchesError),
      control: closeable('control', order),
    }),
    watchesError,
  )

  assert.deepEqual(order, ['mcp', 'watches', 'control'])
})
