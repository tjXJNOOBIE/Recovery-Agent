import { randomUUID } from 'node:crypto'

import type { RecoveryPlan, RecoveryPlanStatus } from '../RecoveryPlan.js'

export interface CreateRecoveryPlanRequest {
  readonly incidentId: string
  readonly nodeId: string
  readonly serviceId: string
  readonly rationale: string
}

export class RecoveryPlanRuntimeState {
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

  public restore(plans: readonly RecoveryPlan[]): void {
    const ids = new Set<string>()
    const pendingTargets = new Set<string>()
    const restored = plans.map((plan, index) => {
      const id = plan.id.trim()
      if (id.length === 0) throw new Error(`Recovery plan[${index}] id must be non-blank`)
      if (ids.has(id)) throw new Error(`Duplicate recovery plan id during restore: ${id}`)
      ids.add(id)
      if (plan.status === 'pending_approval') {
        const target = `${plan.nodeId}/${plan.serviceId}`
        if (pendingTargets.has(target)) {
          throw new Error(`Multiple pending recovery plans cannot be restored for ${target}`)
        }
        pendingTargets.add(target)
      }
      return { ...plan, action: { ...plan.action } }
    })
    this.plans = restored
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

  public findPending(nodeId: string, serviceId: string): RecoveryPlan | undefined {
    return this.plans.find((candidate) =>
      candidate.nodeId === nodeId
      && candidate.serviceId === serviceId
      && candidate.status === 'pending_approval'
    )
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
