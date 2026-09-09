import type { IStrandsAgentRuntime, IStrandsAgentRuntimeBootstrap } from '@tjxjnoobie/strands-bridge'

import type { RecoveryAgentRuntimeConfigBuilder } from '../../agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import type { IRecoveryInvestigator, RecoveryInvestigationRequest, RecoveryInvestigationResult } from './IRecoveryInvestigator.js'
import { RecoveryTriageParser, type RecoveryInvestigationDomain, type RecoveryTriageResult } from './RecoveryTriage.js'

export class StrandsRecoveryInvestigator implements IRecoveryInvestigator {
  private readonly bootstrap: IStrandsAgentRuntimeBootstrap
  private readonly configBuilder: RecoveryAgentRuntimeConfigBuilder
  private readonly triageParser: RecoveryTriageParser

  public constructor(bootstrap: IStrandsAgentRuntimeBootstrap, configBuilder: RecoveryAgentRuntimeConfigBuilder, triageParser = new RecoveryTriageParser()) {
    this.bootstrap = bootstrap
    this.configBuilder = configBuilder
    this.triageParser = triageParser
  }

  public async investigate(request: RecoveryInvestigationRequest): Promise<RecoveryInvestigationResult> {
    const runtime = await this.bootstrap.createAgentRuntime(this.configBuilder.build())
    try {
      const triage = await this.triage(runtime, request)
      const findings: { domain: RecoveryInvestigationDomain; finding: string }[] = []
      for (const domain of triage.domains) {
        const finding = await this.specialist(runtime, domain, triage, request)
        findings.push({ domain, finding })
      }
      const synthesis = await runtime.invokeAgent(
        'Synthesize the recovery investigation into a concise evidence-based diagnosis for an operator. '
        + 'Do not claim any mutation or approval. Distinguish observations from hypotheses and call out deployment correlation when present. '
        + `Triage: ${JSON.stringify(triage)} Specialist findings: ${JSON.stringify(findings)} Evidence: ${JSON.stringify(request)}`,
      )
      const summary = synthesis.toString().trim()
      if (summary.length === 0) throw new Error('Recovery investigation synthesis must not be blank')
      return { summary: summary.slice(0, 8_000), requiresHuman: true }
    } finally {
      await runtime.close()
    }
  }

  private async triage(runtime: IStrandsAgentRuntime, request: RecoveryInvestigationRequest): Promise<RecoveryTriageResult> {
    const response = await runtime.invokeAgent(
      'Triage this recovery incident. Return ONLY strict JSON with exactly '
      + '{"severity":"low"|"medium"|"high"|"critical","domains":["service"|"application"|"dependency"|"deployment"|"node"|"network"],"hypothesis":"..."}. '
      + 'Choose one through three unique domains. Do not claim mutation. '
      + `Evidence: ${JSON.stringify(request)}`,
    )
    try {
      return this.triageParser.parse(response.toString())
    } catch {
      return { severity: 'high', domains: ['service'], hypothesis: 'Structured triage was unavailable; perform bounded service-focused investigation.' }
    }
  }

  private async specialist(runtime: IStrandsAgentRuntime, domain: RecoveryInvestigationDomain, triage: RecoveryTriageResult, request: RecoveryInvestigationRequest): Promise<string> {
    const response = await runtime.invokeAgent(
      `Act as the ${domain} recovery specialist. Investigate only that domain using the supplied incident evidence and any configured read-only investigation tools. `
      + 'Do not execute, approve, or claim any mutation. Return concise observations, likely causes, contradictions, and missing evidence. '
      + `Triage: ${JSON.stringify(triage)} Evidence: ${JSON.stringify(request)}`,
    )
    const finding = response.toString().trim()
    return finding.length === 0 ? `${domain}: no additional evidence produced` : finding.slice(0, 4_000)
  }
}
