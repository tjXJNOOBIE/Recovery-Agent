export const RECOVERY_NODE_PROTOCOL_VERSION = 1 as const
export const RECOVERY_NODE_PROTOCOL_MAX_MESSAGE_BYTES = 1_048_576
export const RECOVERY_NODE_PROTOCOL_MAX_IDENTIFIER_LENGTH = 128
export const RECOVERY_NODE_PROTOCOL_MAX_ERROR_MESSAGE_LENGTH = 1_024

export type RecoveryNodeProtocolOperation =
  | 'inspect_node'
  | 'inspect_service'
  | 'inspect_certificates'
  | 'restart_service'

export type RecoveryNodeProtocolErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'operation_failed'
  | 'protocol_error'
  | 'session_closed'
  | 'timeout'
  | 'unauthorized'

export interface RecoveryNodeProtocolHello {
  readonly version: typeof RECOVERY_NODE_PROTOCOL_VERSION
  readonly type: 'hello'
  readonly nodeId: string
}

export interface RecoveryNodeProtocolInspectNodeRequest {
  readonly version: typeof RECOVERY_NODE_PROTOCOL_VERSION
  readonly type: 'request'
  readonly id: string
  readonly operation: 'inspect_node'
}

export interface RecoveryNodeProtocolInspectServiceRequest {
  readonly version: typeof RECOVERY_NODE_PROTOCOL_VERSION
  readonly type: 'request'
  readonly id: string
  readonly operation: 'inspect_service'
  readonly serviceId: string
}

export interface RecoveryNodeProtocolInspectCertificatesRequest {
  readonly version: typeof RECOVERY_NODE_PROTOCOL_VERSION
  readonly type: 'request'
  readonly id: string
  readonly operation: 'inspect_certificates'
}

export interface RecoveryNodeProtocolRestartServiceRequest {
  readonly version: typeof RECOVERY_NODE_PROTOCOL_VERSION
  readonly type: 'request'
  readonly id: string
  readonly operation: 'restart_service'
  readonly serviceId: string
}

export type RecoveryNodeProtocolRequest =
  | RecoveryNodeProtocolInspectNodeRequest
  | RecoveryNodeProtocolInspectServiceRequest
  | RecoveryNodeProtocolInspectCertificatesRequest
  | RecoveryNodeProtocolRestartServiceRequest

export interface RecoveryNodeProtocolSuccessResponse {
  readonly version: typeof RECOVERY_NODE_PROTOCOL_VERSION
  readonly type: 'response'
  readonly id: string
  readonly ok: true
  readonly result: unknown
}

export interface RecoveryNodeProtocolError {
  readonly code: RecoveryNodeProtocolErrorCode
  readonly message: string
}

export interface RecoveryNodeProtocolErrorResponse {
  readonly version: typeof RECOVERY_NODE_PROTOCOL_VERSION
  readonly type: 'response'
  readonly id: string
  readonly ok: false
  readonly error: RecoveryNodeProtocolError
}

export type RecoveryNodeProtocolResponse = RecoveryNodeProtocolSuccessResponse | RecoveryNodeProtocolErrorResponse
export type RecoveryNodeProtocolMessage = RecoveryNodeProtocolHello | RecoveryNodeProtocolRequest | RecoveryNodeProtocolResponse
