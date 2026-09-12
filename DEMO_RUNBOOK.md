# Recovery Agent demo runbook

## Safe local demo

```bash
npm install
npm run check:legacy
gradle --no-daemon clean check installDist
npm run package:runtime
npm pack
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

## Java packaged control-host smoke

The Java `recovery-agent mcp` process is the packaged control-host surface. It
binds loopback, serves `/healthz` and `/readyz`, and serves the same Java
Function Catalog operator tools over Streamable HTTP. The legacy TypeScript
HTTP adapter remains a migration/reference surface and must not be used as
evidence for the Java product.

The current Tavall service is `recovery-agent-hosted-demo`, running merged
commit `e927658826b6640c51e1b78c9022d86854833220`. Tavall start/restart,
health, MCP initialize, 16-tool discovery, `fleet_status`, and
`service_inspect` were physically verified against the real loopback node.
The committed real-development service failure/recovery footage is recorded in
docs/evidence/VIDEO_EVIDENCE_MANIFEST.json; the MP4 is stored outside Git
under the Tavall campaign video-evidence directory.
