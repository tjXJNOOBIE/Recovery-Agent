import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryStateAuthorityProcessClient } from '../../../src/control/durability/RecoveryStateAuthorityProcessClient.js'

const RESPONDER = String.raw`
const readline = require('node:readline').createInterface({ input: process.stdin })
const snapshot = { schemaVersion: 1, incidents: [], plans: [], semanticWatches: [], restartAttempts: [], audit: [] }
readline.on('line', (line) => {
  const request = JSON.parse(line)
  if (request.operation === 'ping') {
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, available: true }) + '\n')
    return
  }
  if (request.operation === 'load') {
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, revision: 0, snapshot }) + '\n')
    return
  }
  if (request.operation === 'commit') {
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, revision: request.expectedRevision + 1, snapshot: request.snapshot }) + '\n')
  }
})
`

test('exchangesStrictRequestsWithLocalAuthorityProcessAndClosesCleanly', async () => {
  const client = await RecoveryStateAuthorityProcessClient.start({
    command: process.execPath,
    args: ['-e', RESPONDER],
  })

  try {
    const [available, loaded] = await Promise.all([client.ping(), client.load()])
    assert.equal(available, true)
    assert.equal(loaded.revision, 0)

    const committed = await client.commit(loaded.revision, loaded.snapshot)
    assert.equal(committed.revision, 1)
  } finally {
    await client.close()
  }

  await assert.rejects(client.ping(), /client is closed/)
})

test('rejectsWhenAuthorityExitsBeforeProducingResponse', async () => {
  const client = await RecoveryStateAuthorityProcessClient.start({
    command: process.execPath,
    args: ['-e', "process.stdin.once('data', () => process.exit(17))"],
  })

  await assert.rejects(client.load(), /exited before producing a response|code=17/)
  await assert.rejects(client.close(), /code=17/)
})

test('rejectsOversizedAuthorityResponse', async () => {
  const script = String.raw`
  const readline = require('node:readline').createInterface({ input: process.stdin })
  readline.once('line', (line) => {
    const request = JSON.parse(line)
    process.stdout.write(JSON.stringify({ id: request.id, ok: true, available: true, padding: 'x'.repeat(256) }) + '\n')
  })
  `
  const client = await RecoveryStateAuthorityProcessClient.start({
    command: process.execPath,
    args: ['-e', script],
    responseLimitBytes: 128,
  })

  try {
    await assert.rejects(client.ping(), /response exceeded 128 bytes/)
  } finally {
    await client.close()
  }
})
