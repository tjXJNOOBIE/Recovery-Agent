import {
  RECOVERY_NODE_PROTOCOL_MAX_ERROR_MESSAGE_LENGTH,
  RECOVERY_NODE_PROTOCOL_MAX_IDENTIFIER_LENGTH,
  RECOVERY_NODE_PROTOCOL_MAX_MESSAGE_BYTES,
  RECOVERY_NODE_PROTOCOL_VERSION,
  type RecoveryNodeProtocolErrorCode,
  type RecoveryNodeProtocolErrorResponse,
  type RecoveryNodeProtocolHello,
  type RecoveryNodeProtocolMessage,
  type RecoveryNodeProtocolOperation,
  type RecoveryNodeProtocolRequest,
  type RecoveryNodeProtocolSuccessResponse,
} from './RecoveryNodeProtocol.js'

const OPERATIONS: ReadonlySet<RecoveryNodeProtocolOperation> = new Set([
  'inspect_node',
  'inspect_service',
  'inspect_certificates',
  'restart_service',
])

const ERROR_CODES: ReadonlySet<RecoveryNodeProtocolErrorCode> = new Set([
  'invalid_request',
  'not_found',
  'operation_failed',
  'protocol_error',
  'session_closed',
  'timeout',
  'unauthorized',
])

export class RecoveryNodeProtocolParser {
  public parse(line: string): RecoveryNodeProtocolMessage {
    if (Buffer.byteLength(line, 'utf8') > RECOVERY_NODE_PROTOCOL_MAX_MESSAGE_BYTES) {
      throw new Error(`Recovery node protocol message exceeds ${RECOVERY_NODE_PROTOCOL_MAX_MESSAGE_BYTES} bytes`)
    }
    if (line.includes('\n') || line.includes('\r')) {
      throw new Error('Recovery node protocol parser accepts exactly one framed line')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch {
      throw new Error('Recovery node protocol message must be valid JSON')
    }

    const record = this.requireRecord(parsed, 'Recovery node protocol message')
    if (record['version'] !== RECOVERY_NODE_PROTOCOL_VERSION) {
      throw new Error(`Unsupported Recovery node protocol version: ${String(record['version'])}`)
    }

    const type = record['type']
    if (type === 'hello') return this.parseHello(record)
    if (type === 'request') return this.parseRequest(record)
    if (type === 'response') return this.parseResponse(record)
    throw new Error('Recovery node protocol type must be hello, request, or response')
  }

  private parseHello(record: Readonly<Record<string, unknown>>): RecoveryNodeProtocolHello {
    this.requireExactKeys(record, ['version', 'type', 'nodeId'], 'Recovery node hello')
    return {
      version: RECOVERY_NODE_PROTOCOL_VERSION,
      type: 'hello',
      nodeId: this.requireIdentifier(record['nodeId'], 'Recovery node hello nodeId'),
    }
  }

  private parseRequest(record: Readonly<Record<string, unknown>>): RecoveryNodeProtocolRequest {
    const id = this.requireIdentifier(record['id'], 'Recovery node request id')
    const operation = record['operation']
    if (typeof operation !== 'string' || !OPERATIONS.has(operation as RecoveryNodeProtocolOperation)) {
      throw new Error('Recovery node request operation is not supported')
    }

    if (operation === 'inspect_service' || operation === 'restart_service') {
      this.requireExactKeys(record, ['version', 'type', 'id', 'operation', 'serviceId'], `Recovery node ${operation} request`)
      const serviceId = this.requireIdentifier(record['serviceId'], `Recovery node ${operation} serviceId`)
      return operation === 'inspect_service'
        ? { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'request', id, operation, serviceId }
        : { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'request', id, operation, serviceId }
    }

    this.requireExactKeys(record, ['version', 'type', 'id', 'operation'], `Recovery node ${operation} request`)
    return operation === 'inspect_node'
      ? { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'request', id, operation }
      : { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'request', id, operation: 'inspect_certificates' }
  }

  private parseResponse(record: Readonly<Record<string, unknown>>): RecoveryNodeProtocolSuccessResponse | RecoveryNodeProtocolErrorResponse {
    const id = this.requireIdentifier(record['id'], 'Recovery node response id')
    const ok = record['ok']
    if (ok === true) {
      this.requireExactKeys(record, ['version', 'type', 'id', 'ok', 'result'], 'Recovery node success response')
      return {
        version: RECOVERY_NODE_PROTOCOL_VERSION,
        type: 'response',
        id,
        ok: true,
        result: record['result'],
      }
    }
    if (ok === false) {
      this.requireExactKeys(record, ['version', 'type', 'id', 'ok', 'error'], 'Recovery node error response')
      const error = this.requireRecord(record['error'], 'Recovery node response error')
      this.requireExactKeys(error, ['code', 'message'], 'Recovery node response error')
      const code = error['code']
      if (typeof code !== 'string' || !ERROR_CODES.has(code as RecoveryNodeProtocolErrorCode)) {
        throw new Error('Recovery node response error code is not supported')
      }
      return {
        version: RECOVERY_NODE_PROTOCOL_VERSION,
        type: 'response',
        id,
        ok: false,
        error: {
          code: code as RecoveryNodeProtocolErrorCode,
          message: this.requireText(error['message'], 'Recovery node response error message', RECOVERY_NODE_PROTOCOL_MAX_ERROR_MESSAGE_LENGTH),
        },
      }
    }
    throw new Error('Recovery node response ok must be boolean')
  }

  private requireIdentifier(value: unknown, label: string): string {
    return this.requireText(value, label, RECOVERY_NODE_PROTOCOL_MAX_IDENTIFIER_LENGTH)
  }

  private requireText(value: unknown, label: string, maximumLength: number): string {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
      throw new Error(`${label} must be a non-blank string without surrounding whitespace`)
    }
    if (value.length > maximumLength) throw new Error(`${label} exceeds ${maximumLength} characters`)
    if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label} must not contain control characters`)
    return value
  }

  private requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
    return value as Readonly<Record<string, unknown>>
  }

  private requireExactKeys(record: Readonly<Record<string, unknown>>, allowedKeys: readonly string[], label: string): void {
    const allowed = new Set(allowedKeys)
    const keys = Object.keys(record)
    for (const key of keys) {
      if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`)
    }
    for (const key of allowedKeys) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) throw new Error(`${label} is missing required field: ${key}`)
    }
  }
}
