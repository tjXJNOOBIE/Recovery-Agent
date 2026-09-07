# Recovery Agent

A Strands-powered agent for bounded machine and service recovery.

**Agents for Humans track:** Professional

## Install and run

```bash
npx @tjxjnoobie/recovery-agent "your request"
```

Node.js 22+ is required. Model-provider credentials/configuration are supplied through Strands and the environment. Set `RECOVERY_AGENT_MODEL_ID` to select an explicit Strands model ID.

By default Recovery Agent targets the local Agent WebMCP endpoint at `http://127.0.0.1:7188/mcp`; set `RECOVERY_AGENT_MCP_URL` to target another bounded MCP endpoint.

Optional MCP authorization may be supplied through `RECOVERY_AGENT_MCP_AUTHORIZATION`. Secrets are never committed.

## Architecture

```text
Recovery Agent
    -> @tjxjnoobie/custom-strands-bridge
        -> @strands-agents/sdk
            -> model provider
            -> typed MCP/tool surfaces
                -> owning Tavall/third-party runtimes
```

This repository owns Recovery Agent product behavior. Shared Strands bootstrap, MCP composition, invocation, cancellation, agent-as-tool composition, and cleanup remain in `custom-strands-bridge`. Tavall Java infrastructure remains in its owning Java runtimes and is consumed over typed boundaries instead of being recreated in TypeScript.

## Development

```bash
npm install
npm run check
```

The bridge dependency is temporarily pinned to exact Git commit `677f141a73fcc1bed23edf02c8fdfbd116fd034d` while the bridge foundation is still in Draft review. Replace that source pin with the published bridge version once the bridge promotion gates are complete.

See [`docs/recovery-agent/RECOVERY_AGENT_FINAL_DRAFT.md`](docs/recovery-agent/RECOVERY_AGENT_FINAL_DRAFT.md) for the current product foundation contract.
