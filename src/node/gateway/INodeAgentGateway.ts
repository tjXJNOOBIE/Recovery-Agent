import type { ServiceActionResult } from '../data/ServiceActionResult.js'
import type { NodeSnapshot, ServiceSnapshot } from '../data/ServiceSnapshot.js'

export interface INodeAgentGateway {
  readonly nodeId: string
  inspectNode(): Promise<NodeSnapshot>
  inspectService(serviceId: string): Promise<ServiceSnapshot>
  restartService(serviceId: string): Promise<ServiceActionResult>
  close(): Promise<void>
}
