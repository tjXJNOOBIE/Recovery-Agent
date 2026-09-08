import type { StrandsAgentRuntimeConfig } from '@tjxjnoobie/strands-bridge'

import { RECOVERY_AGENT_SYSTEM_PROMPT } from '../prompt/RecoveryAgentSystemPrompt.js'

export type RecoveryAgentEnvironment = Readonly<Record<string, string | undefined>>

export class RecoveryAgentRuntimeConfigBuilder {
  private readonly environment: RecoveryAgentEnvironment

  public constructor(environment: RecoveryAgentEnvironment = process.env) {
    this.environment = environment
  }

  public build(): StrandsAgentRuntimeConfig {
    const modelId = this.optionalString(this.environment['RECOVERY_AGENT_MODEL_ID'])
    const investigationMcpUrl = this.optionalString(this.environment['RECOVERY_AGENT_INVESTIGATION_MCP_URL'])
    const authorization = this.optionalString(this.environment['RECOVERY_AGENT_INVESTIGATION_MCP_AUTHORIZATION'])

    return {
      agent: {
        id: 'recovery-agent-investigator',
        name: 'Recovery Agent Investigator',
        systemPrompt: RECOVERY_AGENT_SYSTEM_PROMPT,
        printer: false,
        traceAttributes: {
          product: 'recovery-agent',
          responsibility: 'incident-investigation',
        },
        ...(modelId === undefined ? {} : { model: modelId }),
      },
      ...(investigationMcpUrl === undefined
        ? {}
        : {
            mcpServers: {
              investigation: {
                url: investigationMcpUrl,
                ...(authorization === undefined ? {} : { headers: { Authorization: authorization } }),
              },
            },
            mcpDefaults: {
              applicationName: 'recovery-agent',
              applicationVersion: '0.1.0',
            },
          }),
    }
  }

  private optionalString(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined
    }

    const normalizedValue = value.trim()
    return normalizedValue.length === 0 ? undefined : normalizedValue
  }
}
