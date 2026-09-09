import type { INodeCertificateProbe } from '../certificate/NodeCertificateProbe.js'
import type { INodeResourceProbe } from '../health/INodeResourceProbe.js'
import type { INodeServiceRuntime } from '../runtime/INodeServiceRuntime.js'
import {
  RECOVERY_NODE_PROTOCOL_VERSION,
  type RecoveryNodeProtocolRequest,
  type RecoveryNodeProtocolResponse,
} from './RecoveryNodeProtocol.js'

export class RecoveryNodeRequestDispatcher {
  private readonly runtime: INodeServiceRuntime
  private readonly resourceProbe: INodeResourceProbe | undefined
  private readonly certificateProbe: INodeCertificateProbe | undefined

  public constructor(runtime: INodeServiceRuntime, resourceProbe?: INodeResourceProbe, certificateProbe?: INodeCertificateProbe) {
    this.runtime = runtime
    this.resourceProbe = resourceProbe
    this.certificateProbe = certificateProbe
  }

  public async dispatch(request: RecoveryNodeProtocolRequest): Promise<RecoveryNodeProtocolResponse> {
    try {
      if (request.operation === 'inspect_node') {
        const [services, resources] = await Promise.all([this.runtime.listServices(), this.resourceProbe?.inspect()])
        return this.success(request.id, {
          nodeId: this.runtime.nodeId,
          observedAt: new Date().toISOString(),
          services,
          ...(resources === undefined ? {} : { resources }),
        })
      }
      if (request.operation === 'inspect_service') return this.success(request.id, await this.runtime.inspectService(request.serviceId))
      if (request.operation === 'inspect_certificates') return this.success(request.id, await this.certificateProbe?.listCertificates() ?? [])
      return this.success(request.id, await this.runtime.restartService(request.serviceId))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        version: RECOVERY_NODE_PROTOCOL_VERSION,
        type: 'response',
        id: request.id,
        ok: false,
        error: {
          code: 'operation_failed',
          message: this.boundMessage(message),
        },
      }
    }
  }

  private success(id: string, result: unknown): RecoveryNodeProtocolResponse {
    return { version: RECOVERY_NODE_PROTOCOL_VERSION, type: 'response', id, ok: true, result }
  }

  private boundMessage(message: string): string {
    const normalized = message.trim().replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    return (normalized.length === 0 ? 'Node operation failed' : normalized).slice(0, 1_024)
  }
}
