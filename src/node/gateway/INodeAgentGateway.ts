import type { CertificateSnapshot } from '../certificate/CertificateSnapshot.js'
import type { ServiceActionResult } from '../data/ServiceActionResult.js'
import type { NodeSnapshot, ServiceSnapshot } from '../data/ServiceSnapshot.js'

export interface INodeAgentGateway {
  readonly nodeId: string
  inspectNode(): Promise<NodeSnapshot>
  inspectService(serviceId: string): Promise<ServiceSnapshot>
  inspectCertificates?(): Promise<readonly CertificateSnapshot[]>
  restartService(serviceId: string): Promise<ServiceActionResult>
  close(): Promise<void>
}
