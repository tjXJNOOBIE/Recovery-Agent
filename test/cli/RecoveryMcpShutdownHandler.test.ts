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

test('attemptsEveryDurableMcpCleanupInOrderAfterEarlierFailure', async () => {
  const order: string[] = []
  const mcpError = new Error('mcp close failed')
  const durabilityError = new Error('durability close failed')
  const transportError = new Error('transport close failed')
  const handler = new RecoveryMcpShutdownHandler()

  await assert.rejects(
    handler.close({
      mcpServer: closeable('mcp', order, mcpError),
      watches: closeable('watches', order),
      approvalServer: closeable('approval', order),
      durability: closeable('durability', order, durabilityError),
      control: closeable('control', order),
      transportServer: closeable('transport', order, transportError),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [mcpError, durabilityError, transportError])
      assert.equal(error.cause, mcpError)
      return true
    },
  )

  assert.deepEqual(order, ['mcp', 'watches', 'approval', 'durability', 'control', 'transport'])
})

test('omitsOptionalApprovalDurabilityAndTransportResourcesWithoutChangingShutdownOrder', async () => {
  const order: string[] = []
  await new RecoveryMcpShutdownHandler().close({
    mcpServer: closeable('mcp', order),
    watches: closeable('watches', order),
    control: closeable('control', order),
  })
  assert.deepEqual(order, ['mcp', 'watches', 'control'])
})
