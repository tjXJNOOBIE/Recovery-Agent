export type RecoveryInvestigationDomain = 'service' | 'application' | 'dependency' | 'deployment' | 'node' | 'network'
export type RecoveryIncidentSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface RecoveryTriageResult {
  readonly severity: RecoveryIncidentSeverity
  readonly domains: readonly RecoveryInvestigationDomain[]
  readonly hypothesis: string
}

export class RecoveryTriageParser {
  private readonly domains = new Set<RecoveryInvestigationDomain>(['service', 'application', 'dependency', 'deployment', 'node', 'network'])

  public parse(value: string): RecoveryTriageResult {
    let parsed: unknown
    try { parsed = JSON.parse(value.trim()) as unknown } catch { throw new Error('Recovery triage must be strict JSON without markdown fencing') }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Recovery triage must be a JSON object')
    const record = parsed as Readonly<Record<string, unknown>>
    const keys = Object.keys(record).sort()
    if (keys.length !== 3 || keys[0] !== 'domains' || keys[1] !== 'hypothesis' || keys[2] !== 'severity') throw new Error('Recovery triage may contain only severity, domains, and hypothesis')
    const severity = record['severity']
    if (severity !== 'low' && severity !== 'medium' && severity !== 'high' && severity !== 'critical') throw new Error('Recovery triage severity is invalid')
    const domainsValue = record['domains']
    if (!Array.isArray(domainsValue) || domainsValue.length === 0 || domainsValue.length > 3) throw new Error('Recovery triage domains must contain one through three entries')
    const domains = domainsValue.map((domain) => {
      if (typeof domain !== 'string' || !this.domains.has(domain as RecoveryInvestigationDomain)) throw new Error(`Recovery triage domain is invalid: ${String(domain)}`)
      return domain as RecoveryInvestigationDomain
    })
    if (new Set(domains).size !== domains.length) throw new Error('Recovery triage domains must not contain duplicates')
    const hypothesis = record['hypothesis']
    if (typeof hypothesis !== 'string' || hypothesis.trim().length === 0 || hypothesis.trim().length > 1_000) throw new Error('Recovery triage hypothesis must be a non-blank string no longer than 1000 characters')
    return { severity, domains, hypothesis: hypothesis.trim() }
  }
}
