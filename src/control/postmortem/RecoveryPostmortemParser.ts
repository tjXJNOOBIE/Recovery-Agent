import type { RecoveryPostmortem, RecoveryPostmortemConfidence } from './RecoveryPostmortem.js'

interface ParsedPostmortem {
  readonly summary: string
  readonly rootCause: string
  readonly contributingFactors: readonly string[]
  readonly recovery: string
  readonly prevention: readonly string[]
  readonly confidence: RecoveryPostmortemConfidence
}

export class RecoveryPostmortemParser {
  public parse(incidentId: string, value: string): RecoveryPostmortem {
    let parsed: unknown
    try { parsed = JSON.parse(value.trim()) as unknown } catch { throw new Error('Recovery postmortem must be strict JSON without markdown fencing') }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Recovery postmortem must be a JSON object')
    const record = parsed as Readonly<Record<string, unknown>>
    const expected = ['confidence', 'contributingFactors', 'prevention', 'recovery', 'rootCause', 'summary']
    const keys = Object.keys(record).sort()
    if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('Recovery postmortem contains unexpected or missing fields')
    const result: ParsedPostmortem = {
      summary: this.string(record, 'summary', 4_000),
      rootCause: this.string(record, 'rootCause', 2_000),
      contributingFactors: this.strings(record, 'contributingFactors', 8, 1_000),
      recovery: this.string(record, 'recovery', 4_000),
      prevention: this.strings(record, 'prevention', 8, 1_000),
      confidence: this.confidence(record['confidence']),
    }
    return { incidentId, ...result }
  }

  private string(record: Readonly<Record<string, unknown>>, key: string, max: number): string {
    const value = record[key]
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > max) throw new Error(`Recovery postmortem ${key} must be a non-blank string no longer than ${max} characters`)
    return value.trim()
  }

  private strings(record: Readonly<Record<string, unknown>>, key: string, maxEntries: number, maxLength: number): readonly string[] {
    const value = record[key]
    if (!Array.isArray(value) || value.length > maxEntries) throw new Error(`Recovery postmortem ${key} must be an array of at most ${maxEntries} entries`)
    return value.map((entry) => {
      if (typeof entry !== 'string' || entry.trim().length === 0 || entry.trim().length > maxLength) throw new Error(`Recovery postmortem ${key} entries must be non-blank strings no longer than ${maxLength} characters`)
      return entry.trim()
    })
  }

  private confidence(value: unknown): RecoveryPostmortemConfidence {
    if (value !== 'low' && value !== 'medium' && value !== 'high') throw new Error('Recovery postmortem confidence must be low, medium, or high')
    return value
  }
}
