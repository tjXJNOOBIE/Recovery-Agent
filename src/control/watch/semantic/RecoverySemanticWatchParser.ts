import type { RecoverySemanticWatchProposal, RecoverySemanticWatchTarget } from './RecoverySemanticWatch.js'

export const MIN_SEMANTIC_WATCH_INTERVAL_SECONDS = 10
export const MAX_SEMANTIC_WATCH_INTERVAL_SECONDS = 86_400

export class RecoverySemanticWatchParser {
  private readonly targets: ReadonlySet<string>

  public constructor(targets: readonly RecoverySemanticWatchTarget[]) {
    this.targets = new Set(targets.map((target) => this.key(target.nodeId, target.serviceId)))
  }

  public parse(value: string): RecoverySemanticWatchProposal {
    let parsed: unknown
    try { parsed = JSON.parse(value.trim()) as unknown } catch { throw new Error('Semantic recovery watch must be strict JSON without markdown fencing') }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Semantic recovery watch must be a JSON object')
    const record = parsed as Readonly<Record<string, unknown>>
    const keys = Object.keys(record).sort()
    const expected = ['intervalSeconds', 'nodeId', 'rationale', 'serviceId']
    if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('Semantic recovery watch may contain only nodeId, serviceId, intervalSeconds, and rationale')

    const nodeId = this.string(record, 'nodeId', 200)
    const serviceId = this.string(record, 'serviceId', 200)
    if (!this.targets.has(this.key(nodeId, serviceId))) throw new Error(`Semantic recovery watch target is not configured: ${nodeId}/${serviceId}`)

    const intervalSeconds = record['intervalSeconds']
    if (typeof intervalSeconds !== 'number' || !Number.isInteger(intervalSeconds) || intervalSeconds < MIN_SEMANTIC_WATCH_INTERVAL_SECONDS || intervalSeconds > MAX_SEMANTIC_WATCH_INTERVAL_SECONDS) {
      throw new Error(`Semantic recovery watch intervalSeconds must be an integer from ${MIN_SEMANTIC_WATCH_INTERVAL_SECONDS} through ${MAX_SEMANTIC_WATCH_INTERVAL_SECONDS}`)
    }

    return {
      nodeId,
      serviceId,
      intervalSeconds,
      rationale: this.string(record, 'rationale', 1_000),
    }
  }

  private string(record: Readonly<Record<string, unknown>>, key: string, maximumLength: number): string {
    const value = record[key]
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maximumLength) throw new Error(`Semantic recovery watch ${key} must be a non-blank string no longer than ${maximumLength} characters`)
    return value.trim()
  }

  private key(nodeId: string, serviceId: string): string { return `${nodeId}/${serviceId}` }
}
