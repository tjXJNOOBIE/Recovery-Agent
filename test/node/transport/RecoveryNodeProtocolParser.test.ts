import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RECOVERY_NODE_PROTOCOL_MAX_MESSAGE_BYTES,
  RECOVERY_NODE_PROTOCOL_VERSION,
} from '../../../src/node/transport/RecoveryNodeProtocol.js'
import { RecoveryNodeProtocolParser } from '../../../src/node/transport/RecoveryNodeProtocolParser.js'

const parser = new RecoveryNodeProtocolParser()

test('parsesOnlyTheFourTypedNodeOperations', () => {
  assert.deepEqual(parser.parse(JSON.stringify({
    version: RECOVERY_NODE_PROTOCOL_VERSION,
    type: 'request',
    id: 'request-1',
    operation: 'inspect_node',
  })), {
    version: 1,
    type: 'request',
    id: 'request-1',
    operation: 'inspect_node',
  })

  assert.deepEqual(parser.parse(JSON.stringify({
    version: 1,
    type: 'request',
    id: 'request-2',
    operation: 'inspect_service',
    serviceId: 'payments',
  })), {
    version: 1,
    type: 'request',
    id: 'request-2',
    operation: 'inspect_service',
    serviceId: 'payments',
  })

  assert.deepEqual(parser.parse(JSON.stringify({
    version: 1,
    type: 'request',
    id: 'request-3',
    operation: 'inspect_certificates',
  })), {
    version: 1,
    type: 'request',
    id: 'request-3',
    operation: 'inspect_certificates',
  })

  assert.deepEqual(parser.parse(JSON.stringify({
    version: 1,
    type: 'request',
    id: 'request-4',
    operation: 'restart_service',
    serviceId: 'payments',
  })), {
    version: 1,
    type: 'request',
    id: 'request-4',
    operation: 'restart_service',
    serviceId: 'payments',
  })
})

test('parsesHelloAndCorrelatedResponses', () => {
  assert.deepEqual(parser.parse('{"version":1,"type":"hello","nodeId":"east-01"}'), {
    version: 1,
    type: 'hello',
    nodeId: 'east-01',
  })
  assert.deepEqual(parser.parse('{"version":1,"type":"response","id":"r1","ok":true,"result":{"healthy":true}}'), {
    version: 1,
    type: 'response',
    id: 'r1',
    ok: true,
    result: { healthy: true },
  })
  assert.deepEqual(parser.parse('{"version":1,"type":"response","id":"r2","ok":false,"error":{"code":"operation_failed","message":"restart rejected"}}'), {
    version: 1,
    type: 'response',
    id: 'r2',
    ok: false,
    error: { code: 'operation_failed', message: 'restart rejected' },
  })
})

test('rejectsUnknownOperationsExtraFieldsAndMalformedTargets', () => {
  assert.throws(
    () => parser.parse('{"version":1,"type":"request","id":"r","operation":"run_shell","command":"id"}'),
    /operation is not supported/,
  )
  assert.throws(
    () => parser.parse('{"version":1,"type":"request","id":"r","operation":"inspect_node","serviceId":"payments"}'),
    /unsupported field: serviceId/,
  )
  assert.throws(
    () => parser.parse('{"version":1,"type":"request","id":"r","operation":"restart_service"}'),
    /missing required field: serviceId/,
  )
  assert.throws(
    () => parser.parse('{"version":1,"type":"request","id":"r","operation":"restart_service","serviceId":" payments "}'),
    /without surrounding whitespace/,
  )
})

test('rejectsWrongVersionMultilineAndOversizedMessages', () => {
  assert.throws(
    () => parser.parse('{"version":2,"type":"hello","nodeId":"east-01"}'),
    /Unsupported Recovery node protocol version/,
  )
  assert.throws(
    () => parser.parse('{"version":1,\n"type":"hello","nodeId":"east-01"}'),
    /exactly one framed line/,
  )
  const oversized = 'x'.repeat(RECOVERY_NODE_PROTOCOL_MAX_MESSAGE_BYTES + 1)
  assert.throws(() => parser.parse(oversized), /exceeds 1048576 bytes/)
})

test('rejectsResponseShapeSmuggling', () => {
  assert.throws(
    () => parser.parse('{"version":1,"type":"response","id":"r","ok":true,"result":{},"operation":"restart_service"}'),
    /unsupported field: operation/,
  )
  assert.throws(
    () => parser.parse('{"version":1,"type":"response","id":"r","ok":false,"error":{"code":"shell_failed","message":"no"}}'),
    /error code is not supported/,
  )
  assert.throws(
    () => parser.parse('{"version":1,"type":"response","id":"r","ok":false,"error":{"code":"protocol_error","message":"bad","secret":"leak"}}'),
    /unsupported field: secret/,
  )
})
