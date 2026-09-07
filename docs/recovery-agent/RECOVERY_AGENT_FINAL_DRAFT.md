# Recovery Agent Final Draft

> **Status:** Working product foundation  
> **Hackathon track:** Professional  
> **Shared runtime:** `@tjxjnoobie/custom-strands-bridge`  
> **Must not define:** a second Strands framework, Tavall Java infrastructure, or unverified external tool capabilities

## About

Recovery Agent is a distinct Agents for Humans product built on the shared Strands bridge. This repository owns the product prompt, configuration, CLI surface, product permissions, future workflow policy, and integration selection.

## Foundation flow

```text
npx @tjxjnoobie/recovery-agent "request"
    -> RecoveryAgentCliHandler
    -> RecoveryAgentRuntimeConfigBuilder
    -> IStrandsAgentRuntimeBootstrap
    -> Strands agent loop
    -> configured model and MCP/tool surfaces
    -> native result
    -> deterministic runtime close
```

The CLI validates its request before external runtime creation and closes the bridge runtime in `finally` whether invocation succeeds or fails.

## Shared runtime dependency

The package intentionally has **no direct `@strands-agents/sdk` dependency**. It currently pins `custom-strands-bridge` to exact Git commit `677f141a73fcc1bed23edf02c8fdfbd116fd034d` so the four agents can develop before bridge publication without losing one-command transitive installation.

When the bridge is promoted and published, replace the Git source with its released npm version. Do not leave an unowned temporary source dependency.

## Product configuration

- `RECOVERY_AGENT_MODEL_ID`: optional explicit Strands model ID.
- `RECOVERY_AGENT_MCP_URL`: optional override; local Agent WebMCP is the current default.
- `RECOVERY_AGENT_MCP_AUTHORIZATION`: optional authorization header value for the configured MCP endpoint.

Blank optional values are treated as absent. Secrets remain environment-owned.

## Current product rule

You are Recovery Agent. Inspect real system and service evidence before choosing an action. Prefer bounded, reversible recovery using only capabilities actually exposed by connected tools. After every mutation, verify the resulting health and state instead of assuming success. Do not invent operations, permissions, logs, or outcomes. Escalate to a human when evidence is insufficient, the required action is outside configured authority, or the change could cause data loss, broaden privilege, or create an unsafe production impact.

This is a system-level behavior contract, not proof that any particular external operation exists. Tool capability comes from the connected runtime catalog.

## Validation requirements

Before promotion from Draft:

- strict TypeScript typecheck;
- delegate tests for config construction, input rejection, invocation delegation, success cleanup, and failure cleanup;
- production build and package dry-run;
- install against the physical published or exact validated bridge package;
- physical `@strands-agents/sdk` validation inherited from the bridge promotion evidence;
- real model invocation using an authorized provider;
- real product MCP/tool smoke test when the product requires tools;
- package install/npx smoke test from a clean consumer directory;
- accurate README/demo evidence showing real action -> execution -> result/state change for claims made in the hackathon submission.

The current container may use the bridge contract shim for local compile/delegate validation, but neither this document nor the PR may call that physical Strands integration.
