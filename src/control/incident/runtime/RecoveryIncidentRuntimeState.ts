import { randomUUID } from 'node:crypto'

import type { IncidentEventKind, IncidentRecord, IncidentStatus } from '../data/IncidentRecord.js'

export class RecoveryIncidentRuntimeState {
  private incidents: IncidentRecord[] = []

  public open(nodeId: string, serviceId: string, message: string): IncidentRecord {
    const now = new Date().toISOString()
    const incident: IncidentRecord = {
      id: randomUUID(),
      nodeId,
      serviceId,
      openedAt: now,
      status: 'open',
      timeline: [{ at: now, kind: 'detected', message }],
    }
    this.incidents = [...this.incidents, incident]
    return incident
  }

  public append(id: string, kind: IncidentEventKind, message: string, status?: IncidentStatus): IncidentRecord {
    const current = this.require(id)
    const next: IncidentRecord = {
      ...current,
      status: status ?? current.status,
      timeline: [...current.timeline, { at: new Date().toISOString(), kind, message }],
    }
    this.incidents = this.incidents.map((incident) => incident.id === id ? next : incident)
    return next
  }

  public restore(incidents: readonly IncidentRecord[]): void {
    const seen = new Set<string>()
    const restored = incidents.map((incident, index) => {
      const id = incident.id.trim()
      if (id.length === 0) throw new Error(`Recovery incident[${index}] id must be non-blank`)
      if (seen.has(id)) throw new Error(`Duplicate recovery incident id during restore: ${id}`)
      if (incident.timeline.length === 0) throw new Error(`Recovery incident ${id} timeline must be non-empty`)
      seen.add(id)
      return {
        ...incident,
        id,
        nodeId: incident.nodeId.trim(),
        serviceId: incident.serviceId.trim(),
        timeline: incident.timeline.map((entry) => ({ ...entry })),
      }
    })
    this.incidents = restored
  }

  public list(): readonly IncidentRecord[] {
    return this.incidents
  }

  public find(id: string): IncidentRecord | undefined {
    return this.incidents.find((incident) => incident.id === id)
  }

  public findHumanRequired(nodeId: string, serviceId: string): IncidentRecord | undefined {
    return this.findLatestByStatus(nodeId, serviceId, 'human_required')
  }

  public findDependencyBlocked(nodeId: string, serviceId: string): IncidentRecord | undefined {
    return this.findLatestByStatus(nodeId, serviceId, 'dependency_blocked')
  }

  public require(id: string): IncidentRecord {
    const incident = this.find(id)
    if (incident === undefined) {
      throw new Error(`Unknown recovery incident: ${id}`)
    }
    return incident
  }

  private findLatestByStatus(nodeId: string, serviceId: string, status: IncidentStatus): IncidentRecord | undefined {
    for (let index = this.incidents.length - 1; index >= 0; index -= 1) {
      const incident = this.incidents[index]
      if (
        incident !== undefined
        && incident.nodeId === nodeId
        && incident.serviceId === serviceId
        && incident.status === status
      ) {
        return incident
      }
    }
    return undefined
  }
}
