import type { RecoveryNodeResourceViolation } from './RecoveryNodeWatchDefinition.js'

export type NodeHealthIncidentStatus = 'open' | 'resolved'

export interface NodeHealthIncidentTimelineEntry {
  readonly at: string
  readonly message: string
}

export interface NodeHealthIncident {
  readonly id: string
  readonly nodeId: string
  readonly status: NodeHealthIncidentStatus
  readonly openedAt: string
  readonly updatedAt: string
  readonly violations: readonly RecoveryNodeResourceViolation[]
  readonly timeline: readonly NodeHealthIncidentTimelineEntry[]
}
