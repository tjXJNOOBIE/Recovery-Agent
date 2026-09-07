import type { StrandsAgentRuntimeConfig } from '@tjxjnoobie/custom-strands-bridge'

import { RECOVERY_AGENT_SYSTEM_PROMPT } from '../prompt/RecoveryAgentSystemPrompt.js'

export type RecoveryAgentEnvironment = Readonly<Record<string, string | undefined>>

export class RecoveryAgentRuntimeConfigBuilder {
  private readonly environment: RecoveryAgentEnvironment

  public constructor(environment: RecoveryAgentEnvironment = process.env) {
    this.environment = environment
  }

  public build(): StrandsAgentRuntimeConfig {
    const modelId = this.optionalString(this.environment['RECOVERY_AGENT_MODEL_ID'])
    const mcpUrl = this.optionalString(this.environment['RECOVERY_AGENT_MCP_URL']) ?? "http://127.0.0.1:7188/mcp"

    const authorization = this.optionalString(
      this.environment['RECOVERY_AGENT_MCP_AUTHORIZATION'],
    )

    const runtimeConfig: StrandsAgentRuntimeConfig = {
      agent: {
        id: 'recovery-agent',
        name: 'Recovery Agent',
        systemPrompt: RECOVERY_AGENT_SYSTEM_PROMPT,
        printer: false,
        traceAttributes: {
          product: 'recovery-agent',
          hackathonTrack: 'Professional',
        },
        ...(modelId === undefined ? {} : { model: modelId }),
      },
      ...(mcpUrl === undefined
        ? {}
        : {
            mcpServers: {
              product: {
                url: mcpUrl,
                ...(authorization === undefined
                  ? {}
                  : { headers: { Authorization: authorization } }),
              },
            },
            mcpDefaults: {
              applicationName: 'recovery-agent',
              applicationVersion: '0.1.0',
            },
          }),
    }

    return runtimeConfig
  }

  private optionalString(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined
    }

    const normalizedValue = value.trim()

    return normalizedValue.length === 0 ? undefined : normalizedValue
  }
}
