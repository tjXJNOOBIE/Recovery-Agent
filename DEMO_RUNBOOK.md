# Recovery Agent demo runbook

## Safe local demo

```bash
npm install
npm run check
npm run demo
```

The demo is explicitly labeled `SIMULATED DEMONSTRATION`; it is not evidence
of a production restart.

## Physical acceptance

The authoritative physical path is now merged from PR #9 and
`.github/workflows/production-systemd-acceptance.yml`. It builds a packed
consumer, creates a disposable PostgreSQL authority, generates a short-lived
mTLS identity, starts a restricted non-root node, exposes one fixed
`recovery-acceptance.service`, stops it outside Recovery, invokes
`service_recover` through a persistent real MCP client after Inspector tool
negotiation, and verifies a second process start
plus fresh health. The caller cannot supply a unit name or shell command.

## Evidence boundary

Node 22/Java 25/TypeScript, secure transport, clean package installation, and
the physical systemd gate passed on merged main. Run 34466113051 recorded
`recovered`, `restartAttempts: 1`, `resultingLifecycleState: running`,
`resultingHealthy: true`, `targetStartCount: 2`, and rejection of a
caller-supplied unit. Do not present the local simulated demo as physical
recovery evidence.

## Hosted control-host smoke

The HTTP adapter wraps the same stdio MCP control host and is suitable for a
Tavall `EXTERNAL_SYSTEMD` service. A physical local smoke used a real loopback
node configuration and the running `e2e-life-agent-hosted-demo.service` as a
read-only inspected target. It passed HTTP health, MCP initialize, 16-tool
discovery, `fleet_status`, and `service_inspect`, then terminated both child
processes cleanly. This smoke does not claim an external public endpoint or an
authorized model invocation.

The current Tavall service is `recovery-agent-hosted-demo`, running merged
commit `e927658826b6640c51e1b78c9022d86854833220`. Tavall start/restart,
health, MCP initialize, 16-tool discovery, `fleet_status`, and
`service_inspect` were physically verified against the real loopback node.
