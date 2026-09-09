import type { RecoveryPlanProposal } from './RecoveryPlan.js'

export class RecoveryPlanProposalParser {
  public parse(value: string): RecoveryPlanProposal {
    const normalized = value.trim()
    if (normalized.length === 0) {
      throw new Error('Recovery plan proposal must not be blank')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(normalized) as unknown
    } catch {
      throw new Error('Recovery plan proposal must be strict JSON without markdown fencing')
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Recovery plan proposal must be a JSON object')
    }

    const record = parsed as Readonly<Record<string, unknown>>
    const keys = Object.keys(record).sort()
    if (keys.length !== 2 || keys[0] !== 'action' || keys[1] !== 'rationale') {
      throw new Error('Recovery plan proposal may contain only action and rationale')
    }

    const action = record['action']
    if (action !== 'restart_service' && action !== 'none') {
      throw new Error('Recovery plan proposal action must be restart_service or none')
    }

    const rationale = record['rationale']
    if (typeof rationale !== 'string' || rationale.trim().length === 0) {
      throw new Error('Recovery plan proposal rationale must be a non-blank string')
    }

    const normalizedRationale = rationale.trim()
    if (normalizedRationale.length > 2_000) {
      throw new Error('Recovery plan proposal rationale must not exceed 2000 characters')
    }

    return { action, rationale: normalizedRationale }
  }
}
