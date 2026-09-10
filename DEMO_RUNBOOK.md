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

The authoritative physical path is PR #9 and
`.github/workflows/production-systemd-acceptance.yml`. It builds a packed
consumer, creates a disposable PostgreSQL authority, generates a short-lived
mTLS identity, starts a restricted non-root node, exposes one fixed
`recovery-acceptance.service`, stops it outside Recovery, invokes
`service_recover` through MCP Inspector, and verifies a second process start
plus fresh health. The caller cannot supply a unit name or shell command.

## Evidence boundary

Node 22/Java 25/TypeScript and secure-transport gates have passed on the
current acceptance head. The latest physical systemd run stopped before node
startup; rerun PR #9 after the harness startup diagnostics complete. Do not
present the local simulated demo as physical recovery evidence.
