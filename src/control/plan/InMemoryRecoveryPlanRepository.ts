import { randomUUID } from 'node:crypto'

import type { RecoveryPlan, RecoveryPlanStatus } from './RecoveryPlan.js'

export interface CreateRecoveryPlanRequest {
  readonly incidentId: string
  readonly nodeId: string
  readonly serviceId: string
  readonly rationale: string
}

export class InMemoryRecoveryPlanRepository {
  private plans: RecoveryPlan[] = []

  public create(request: CreateRecoveryPlanRequest): RecoveryPlan {
    const now = new Date().toISOString()
    const plan: RecoveryPlan = {
      id: randomUUID(),
      incidentId: request.incidentId,
      nodeId: request.nodeId,
      serviceId: request.serviceId,
      action: { type: 'restart_service' },
      rationale: request.rationale,
      risk: 'elevated',
      status: 'pending_approval',
      createdAt: now,
      updatedAt: now,
    }
    this.plans = [...this.plans, plan]
    return plan
  }

  public list(): readonly RecoveryPlan[] {
    return this.plans
  }

  public require(id: string): RecoveryPlan {
    const plan = this.plans.find((candidate) => candidate.id === id)
    if (plan === undefined) {
      throw new Error(`Unknown recovery plan: ${id}`)
    }
    return plan
  }

  public transition(id: string, expected: RecoveryPlanStatus, status: RecoveryPlanStatus, outcome?: string): RecoveryPlan {
    const current = this.require(id)
    if (current.status !== expected) {
      throw new Error(`Recovery plan ${id} is ${current.status}; expected ${expected}`)
    }

    const next: RecoveryPlan = {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
      ...(outcome === undefined ? {} : { outcome }),
    }
    this.plans = this.plans.map((candidate) => candidate.id === id ? next : candidate)
    return next
  }
}
