import { randomUUID } from 'node:crypto'

import type { NodeHealthIncident } from './NodeHealthIncident.js'
import type { RecoveryNodeResourceViolation } from './RecoveryNodeWatchDefinition.js'

export class InMemoryNodeHealthIncidentRepository {
  private incidents: NodeHealthIncident[] = []

  public list(): readonly NodeHealthIncident[] {
    return this.incidents
  }

  public findOpen(nodeId: string): NodeHealthIncident | undefined {
    return [...this.incidents].reverse().find((incident) => incident.nodeId === nodeId && incident.status === 'open')
  }

  public openOrUpdate(
    nodeId: string,
    violations: readonly RecoveryNodeResourceViolation[],
    message: string,
  ): NodeHealthIncident {
    const current = this.findOpen(nodeId)
    const now = new Date().toISOString()
    if (current === undefined) {
      const incident: NodeHealthIncident = {
        id: randomUUID(),
        nodeId,
        status: 'open',
        openedAt: now,
        updatedAt: now,
        violations: [...violations],
        timeline: [{ at: now, message }],
      }
      this.incidents = [...this.incidents, incident]
      return incident
    }

    if (this.sameViolations(current.violations, violations) && current.timeline.at(-1)?.message === message) return current
    const next: NodeHealthIncident = {
      ...current,
      updatedAt: now,
      violations: [...violations],
      timeline: [...current.timeline, { at: now, message }],
    }
    this.incidents = this.incidents.map((incident) => incident.id === current.id ? next : incident)
    return next
  }

  public resolve(nodeId: string, message: string): NodeHealthIncident | undefined {
    const current = this.findOpen(nodeId)
    if (current === undefined) return undefined
    const now = new Date().toISOString()
    const next: NodeHealthIncident = {
      ...current,
      status: 'resolved',
      updatedAt: now,
      violations: [],
      timeline: [...current.timeline, { at: now, message }],
    }
    this.incidents = this.incidents.map((incident) => incident.id === current.id ? next : incident)
    return next
  }

  private sameViolations(
    left: readonly RecoveryNodeResourceViolation[],
    right: readonly RecoveryNodeResourceViolation[],
  ): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
  }
}
