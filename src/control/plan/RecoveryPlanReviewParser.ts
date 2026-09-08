import type { RecoveryPlanReview } from './IRecoveryPlanCritic.js'

export class RecoveryPlanReviewParser {
  public parse(value: string): RecoveryPlanReview {
    let parsed: unknown
    try { parsed = JSON.parse(value.trim()) as unknown } catch { throw new Error('Recovery plan review must be strict JSON without markdown fencing') }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Recovery plan review must be a JSON object')
    const record = parsed as Readonly<Record<string, unknown>>
    const keys = Object.keys(record).sort()
    if (keys.length !== 2 || keys[0] !== 'accepted' || keys[1] !== 'concerns') throw new Error('Recovery plan review may contain only accepted and concerns')
    const accepted = record['accepted']
    if (typeof accepted !== 'boolean') throw new Error('Recovery plan review accepted must be boolean')
    const concernsValue = record['concerns']
    if (!Array.isArray(concernsValue) || concernsValue.length > 5) throw new Error('Recovery plan review concerns must be an array of at most five entries')
    const concerns = concernsValue.map((concern) => {
      if (typeof concern !== 'string' || concern.trim().length === 0 || concern.trim().length > 500) throw new Error('Recovery plan review concerns must be non-blank strings no longer than 500 characters')
      return concern.trim()
    })
    return { accepted, concerns }
  }
}
