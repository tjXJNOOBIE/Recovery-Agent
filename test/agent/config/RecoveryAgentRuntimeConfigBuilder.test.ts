import assert from 'node:assert/strict'
import test from 'node:test'

import { RecoveryAgentRuntimeConfigBuilder } from '../../../src/agent/config/RecoveryAgentRuntimeConfigBuilder.js'
import { RECOVERY_AGENT_SYSTEM_PROMPT } from '../../../src/agent/prompt/RecoveryAgentSystemPrompt.js'

test('buildsStableInvestigatorIdentityWithoutExternalMcpByDefault', () => {
  const runtimeConfig = new RecoveryAgentRuntimeConfigBuilder({}).build()

  assert.equal(runtimeConfig.agent.id, 'recovery-agent-investigator')
  assert.equal(runtimeConfig.agent.name, 'Recovery Agent Investigator')
  assert.equal(runtimeConfig.agent.systemPrompt, RECOVERY_AGENT_SYSTEM_PROMPT)
  assert.equal(runtimeConfig.agent.printer, false)
  assert.equal(runtimeConfig.agent.model, undefined)
  assert.equal(runtimeConfig.mcpServers, undefined)
})

test('buildsConfiguredModelAndInvestigationMcpBoundaryFromEnvironment', () => {
  const builder = new RecoveryAgentRuntimeConfigBuilder({
    RECOVERY_AGENT_MODEL_ID: ' model.example ',
    RECOVERY_AGENT_INVESTIGATION_MCP_URL: ' https://example.invalid/mcp ',
    RECOVERY_AGENT_INVESTIGATION_MCP_AUTHORIZATION: ' Bearer example ',
  })

  const runtimeConfig = builder.build()

  assert.equal(runtimeConfig.agent.model, 'model.example')
  assert.notEqual(typeof runtimeConfig.mcpServers, 'string')
  const configuredMcpServers = typeof runtimeConfig.mcpServers === 'string'
    ? undefined
    : runtimeConfig.mcpServers
  assert.equal(configuredMcpServers?.investigation?.url, 'https://example.invalid/mcp')
  assert.deepEqual(configuredMcpServers?.investigation?.headers, {
    Authorization: 'Bearer example',
  })
  assert.equal(runtimeConfig.mcpDefaults?.applicationName, 'recovery-agent')
  assert.equal(runtimeConfig.mcpDefaults?.applicationVersion, '0.1.0')
})

test('ignoresBlankOptionalInvestigationEnvironmentValues', () => {
  const runtimeConfig = new RecoveryAgentRuntimeConfigBuilder({
    RECOVERY_AGENT_MODEL_ID: '   ',
    RECOVERY_AGENT_INVESTIGATION_MCP_URL: '   ',
    RECOVERY_AGENT_INVESTIGATION_MCP_AUTHORIZATION: '   ',
  }).build()

  assert.equal(runtimeConfig.agent.model, undefined)
  assert.equal(runtimeConfig.mcpServers, undefined)
})
