import { randomUUID } from 'node:crypto'

import type { NodeHealthIncident } from './NodeHealthIncident.js'
import type { RecoveryNodeResourceViolation } from './RecoveryNodeWatchDefinition.js'

export class NodeHealthIncidentRuntimeState {
  private incidents: NodeHealthIncident[] = []

  public list(): readonly NodeHealthIncident[] { return this.incidents }

  public restore(incidents: readonly NodeHealthIncident[]): void {
    const ids = new Set<string>()
    this.incidents = incidents.map((incident, index) => {
      const id = incident.id.trim(); const nodeId = incident.nodeId.trim()
      if (id.length === 0 || nodeId.length === 0) throw new Error(`Node-health incident[${index}] identity must be non-blank`)
      if (ids.has(id)) throw new Error(`Duplicate node-health incident id during restore: ${id}`)
      if (incident.timeline.length === 0) throw new Error(`Node-health incident ${id} timeline must be non-empty`)
      ids.add(id)
      return {
        ...incident,
        id,
        nodeId,
        violations: incident.violations.map((violation) => ({ ...violation })),
        timeline: incident.timeline.map((entry) => ({ ...entry })),
      }
    })
  }

  public findOpen(nodeId: string): NodeHealthIncident | undefined { return [...this.incidents].reverse().find((incident) => incident.nodeId === nodeId && incident.status === 'open') }

  public openOrUpdate(nodeId: string, violations: readonly RecoveryNodeResourceViolation[], message: string): NodeHealthIncident {
    const current = this.findOpen(nodeId); const now = new Date().toISOString()
    if (current === undefined) {
      const incident: NodeHealthIncident = { id: randomUUID(), nodeId, status: 'open', openedAt: now, updatedAt: now, violations: [...violations], timeline: [{ at: now, message }] }
      this.incidents = [...this.incidents, incident]; return incident
    }
    if (this.sameViolations(current.violations, violations) && current.timeline.at(-1)?.message === message) return current
    const next: NodeHealthIncident = { ...current, updatedAt: now, violations: [...violations], timeline: [...current.timeline, { at: now, message }] }
    this.incidents = this.incidents.map((incident) => incident.id === current.id ? next : incident); return next
  }

  public resolve(nodeId: string, message: string): NodeHealthIncident | undefined {
    const current = this.findOpen(nodeId); if (current === undefined) return undefined
    const now = new Date().toISOString(); const next: NodeHealthIncident = { ...current, status: 'resolved', updatedAt: now, violations: [], timeline: [...current.timeline, { at: now, message }] }
    this.incidents = this.incidents.map((incident) => incident.id === current.id ? next : incident); return next
  }

  private sameViolations(left: readonly RecoveryNodeResourceViolation[], right: readonly RecoveryNodeResourceViolation[]): boolean { return JSON.stringify(left) === JSON.stringify(right) }
}
