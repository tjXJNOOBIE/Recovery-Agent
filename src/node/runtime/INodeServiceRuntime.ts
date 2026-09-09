import type { ServiceActionResult } from '../data/ServiceActionResult.js'
import type { ServiceSnapshot } from '../data/ServiceSnapshot.js'

export interface INodeServiceRuntime {
  readonly nodeId: string
  listServices(): Promise<readonly ServiceSnapshot[]>
  inspectService(serviceId: string): Promise<ServiceSnapshot>
  restartService(serviceId: string): Promise<ServiceActionResult>
}
