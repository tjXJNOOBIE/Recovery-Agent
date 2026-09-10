# Agents for Humans submission: Recovery Agent

## Tagline

When a known service fails, Recovery Agent gathers evidence, performs one
bounded typed recovery, and proves the service is healthy again.

## Problem and audience

Small teams cannot watch every Linux service, but anonymous AI shell access is
too dangerous. Recovery Agent is for developers and operators who need
bounded self-healing with durable evidence and an explicit human boundary for
elevated actions.

## How Strands is used

Strands performs bounded triage, specialist reasoning, proposal planning, and
veto-style critique. Deterministic code owns service mappings, health probes,
restart budgets, write-ahead durability, mTLS transport, systemd mutation,
verification, and audit. Model-facing MCP never owns approval.

## Installation and testing

See [README.md](README.md), [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md), and
[docs/ARCHITECTURE.svg](docs/ARCHITECTURE.svg). Main includes the physical
packaged systemd acceptance harness and its captured GitHub run evidence. The
ordinary local demo is clearly simulated.

## Pre-existing components disclosure

Recovery Agent’s product/control-plane work was built for this hackathon. It
reuses the pre-existing Strands SDK, shared `strands-bridge`, Tavall Database,
Tavall Cloud development/runtime infrastructure, Node.js, Java, PostgreSQL,
and MCP libraries. The production node is intentionally a narrow product
adapter, not a replacement for Tavall Java ownership.

## AWS and video

No AWS service is claimed until used by the final deployment. Add the public
video URL and AWS Builder ID in Devpost as human submission fields.

The repository also includes an authenticated HTTP/MCP adapter for the
existing control-host process. It was physically smoke-tested against a real
loopback Recovery node; public hosting and a judge endpoint remain deployment
boundary work.

Controlled hosted acceptance is available through Tavall service
`recovery-agent-hosted-demo` at loopback MCP `/mcp`, backed by the real
loopback node and systemd target. This is not a public judge endpoint.
