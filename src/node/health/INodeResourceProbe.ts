import type { NodeResourceSnapshot } from '../data/NodeResourceSnapshot.js'

export interface INodeResourceProbe {
  inspect(): Promise<NodeResourceSnapshot>
}
