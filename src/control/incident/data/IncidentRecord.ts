export type IncidentStatus = 'open' | 'recovering' | 'approval_required' | 'resolved' | 'human_required'
export type IncidentEventKind = 'detected' | 'action' | 'verification' | 'investigation' | 'plan_proposed' | 'approval' | 'plan_execution' | 'resolved' | 'escalated'

export interface IncidentTimelineEntry {
  readonly at: string
  readonly kind: IncidentEventKind
  readonly message: string
}

export interface IncidentRecord {
  readonly id: string
  readonly nodeId: string
  readonly serviceId: string
  readonly openedAt: string
  readonly status: IncidentStatus
  readonly timeline: readonly IncidentTimelineEntry[]
}
