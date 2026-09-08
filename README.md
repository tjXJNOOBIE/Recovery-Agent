# Recovery Agent

Recovery Agent is a control-host recovery runtime for Linux services. AI stays on the control host; production machines expose only narrow typed health and recovery operations. ChatGPT, Claude, Codex, or another MCP host can inspect incidents, run bounded recovery, create semantic watches, and review evidence without receiving arbitrary shell or approval authority.

**Agents for Humans track:** Professional

> **Current status:** Draft E2E foundation. Deterministic service recovery, application probes, Linux/node/certificate/deployment watches, Recovery Readiness, semantic service watches, dependency-aware rolling recovery budgets, bounded Strands investigation/planning/critic/postmortem roles, local human approval, restart-safe primary control-state durability, and packaged control-host installation are implemented. GitHub fallback validation physically exercises the Node 22 product, Java 25 state authority, clean npm consumer install, PostgreSQL 17 durability, bundled authority discovery, MCP startup, and labeled demo. Production remote transport, secondary watch-state durability, accountable production approval identity, real-model Recovery validation, broader adapters/actions, and current-host/Inspector acceptance remain promotion gates.

## Runtime shape

```text
MCP host
  -> Recovery MCP server
      -> deterministic RecoveryControlRuntime
          -> fleet inspection + Recovery Readiness
          -> dependency gate + rolling restart budget
          -> write-ahead durability barrier
          -> typed node HTTP gateways
              -> fixed systemd service mappings
              -> fixed HTTP/TCP application probes
              -> Linux resource/filesystem evidence
              -> fixed TLS certificate evidence
              -> deployment marker evidence
          -> combined deterministic watches
              node -> certificate -> deployment -> service recovery -> readiness
          -> semantic watch compiler
              Strands once on create/update
              -> strict configured target + bounded interval
              -> deterministic recurring execution afterward
          -> Strands triage -> specialists -> synthesis
          -> strict restart_service|none planner
          -> veto-only critic
          -> target-bound pending plan
          -> resolved-only postmortem

control-host human
  -> recovery-agent approve/reject
      -> owner-only Unix socket (0600)
          -> separate approval token
          -> dependency re-check
          -> durable approval intent before mutation
          -> one already-bound typed action
          -> fresh verification + durable outcome

control-host durability
  -> strict stdio protocol
      -> bundled Java 25 Recovery state authority
          -> Tavall Database
              -> PostgreSQL
```

There is no normal arbitrary-shell recovery surface.

## Requirements

- Node.js 22+
- Java 25 when durable state is enabled
- PostgreSQL when durable state is enabled

Packaged npm artifacts include the Java state-authority launcher and its runtime JARs. An end user running a packaged build does **not** need Gradle or Tavall GitHub Packages credentials. Source/release packaging still needs the build-time credentials required to resolve Tavall Database.

## Demo

```bash
npm install
npm run demo
```

The demo starts an ephemeral loopback node and drives the same HTTP gateway, control runtime, watch, incident, and planning boundaries used by the product. It is explicitly labeled `SIMULATED DEMONSTRATION`. Simulated model/host behavior is never presented as physical production evidence.

## Node agent

```bash
export RECOVERY_NODE_TOKEN_EAST_01='replace-with-a-long-random-secret'
recovery-agent node ./node.json
```

Public service IDs map to configured systemd units. Remote/model callers cannot supply unit names, shell commands, application-health URLs or ports, TLS targets, or deployment marker paths.

Configured service health can combine systemd lifecycle with fixed HTTP/TCP probes. A running unit with a failed configured application probe remains unhealthy. Linux node evidence is collected without shell execution from `/proc`, Node OS APIs, `statfs`, and mount information.

The node HTTP transport currently defaults to loopback. Public-network production use is **not** claimed until outbound enrollment, mTLS, credential rotation, and production remote transport are implemented.

## Control host

```bash
export RECOVERY_NODE_TOKEN_EAST_01='replace-with-the-same-secret'
export RECOVERY_APPROVAL_TOKEN='replace-with-a-separate-long-approval-secret'
recovery-agent mcp ./control.json
```

Recovery Agent uses the official MCP TypeScript server SDK v2. Approval/rejection remain outside model-facing MCP.

Current model-facing tools:

- `fleet_status`
- `recovery_readiness`
- `node_inspect`
- `service_inspect`
- `service_recover`
- `health_sweep`
- `watch_list`
- `watch_run`
- `watch_create`
- `watch_update`
- `watch_remove`
- `incident_list`
- `incident_inspect`
- `incident_postmortem`
- `recovery_plan_list`
- `recovery_plan_inspect`

## Durable control state

Durability is optional for local development but is the restart-safe control-host path.

A packaged Linux/macOS control host can enable the bundled state authority by supplying PostgreSQL configuration:

```bash
export RECOVERY_STATE_JDBC_URL='jdbc:postgresql://127.0.0.1:5432/recovery'
export RECOVERY_STATE_DB_USERNAME='recovery'
export RECOVERY_STATE_DB_PASSWORD='replace-me'
# Use only where this process is intentionally allowed to create/update schema:
export RECOVERY_STATE_GENERATE_SCHEMA='true'

recovery-agent mcp ./control.json
```

`RECOVERY_STATE_AUTHORITY_COMMAND` may explicitly override the bundled launcher. Windows currently requires an explicit authority command rather than bundled auto-resolution.

The TypeScript runtime never connects directly to PostgreSQL. It talks over a strict newline-delimited stdio protocol to a product-specific Java 25 authority, which consumes `TavallStudios/tavall-database`. Database/JPA lifecycle, transaction, flush/rollback, and provider mechanics remain owned by Tavall Database.

Durable schema-v1 state currently includes:

- service recovery incidents and timelines;
- typed recovery plans and statuses;
- semantic service-watch definitions;
- rolling automatic restart-attempt history;
- append-only Recovery audit entries.

Still process-local today:

- node-health watch incidents/state;
- certificate watch incidents/state;
- deployment-correlation incidents/state;
- transient watch scheduler/runtime timestamps.

The authority uses a monotonic application revision separate from Hibernate's internal optimistic-lock version. Stale revisions fail closed, audit history cannot be rewritten or truncated, and local checkpoints are serialized so concurrent service recovery does not race against its own revision stream.

### Write-ahead mutation safety

Recovery Agent persists mutation intent **before** an external restart is allowed:

```text
unhealthy target
  -> update incident / spend automatic restart slot
  -> durable checkpoint
      -> failure: execute zero restart; latch mutations disabled for this process
      -> success: execute one typed restart
          -> fresh verification
          -> durable outcome checkpoint
```

The same rule applies to operator-approved recovery: the approved plan/incident state must durably commit before the bound restart executes. A durability checkpoint failure permanently disables further mutation-intent operations in that process while read-only inspection remains available.

Semantic-watch create/update/remove is also durable when the authority is enabled. Because those operations have no external node side effect, failed persistence restores the prior in-memory semantic-watch definitions.

## Semantic service watches

Operators can create or update a recurring service-recovery watch using natural language:

```text
"Watch payments every two minutes"
        ↓ Strands once
{ nodeId, serviceId, intervalSeconds, rationale }
        ↓ strict parser + configured-target validation
RecoveryWatchService interval override
        ↓
normal deterministic recoverService() on each due interval
```

The compiler may choose only an already-configured node/service target and an interval from **10 seconds through 24 hours**. It cannot create URLs, ports, commands, credentials, recovery actions, conditions, or infrastructure.

`watch_run` and recurring scheduling do **not** invoke Strands. When durable state is enabled, semantic watch definitions are restored before watches or MCP are exposed on control-host startup.

## Recovery Readiness

`recovery_readiness` classifies configured targets as `ready`, `limited`, `blocked`, or `unreachable` using the same policy, rolling budget, dependency, plan, and incident state used by execution. It is read-only and runs automatically every five minutes.

## Recovery safety

- Same-target concurrent recovery shares one in-flight operation.
- Unhealthy dependencies block downstream mutation and consume zero restart budget.
- `health_sweep` orders dependencies before dependents.
- `pending_approval` suppresses duplicate automatic recovery/plans.
- `human_required` suppresses repeated mutation/Strands loops until verified external recovery.
- Successful automatic restarts consume the rolling budget too.
- Every node mutation is followed by fresh deterministic verification.
- One unreachable node does not hide the reachable fleet.

## Built-in watches

### Linux Node Watch

Read-only evidence includes memory, swap, root filesystem byte/inode pressure, root read-only state, one-minute load per CPU, uptime, and request-midpoint clock drift. Defaults are 92% memory, 80% swap, 90% root bytes, 90% root inodes, 2.0 load/CPU, writable root, and <=30 seconds clock drift.

Node pressure/skew opens node-health incidents but cannot reboot, drain, destroy, or rewrite time.

### Certificate Watch

Configured TLS targets are inspected every six hours by default. Warning begins at <=30 days remaining, critical at <=7 days, and authorization failure is critical. Invalid certificates can be observed without being treated as trusted. Certificate failures do not spend service restart budget.

### Deployment correlation

An optional node-configured `deploymentMarkerFile` is reduced to SHA-256/timestamp evidence without exposing contents/path. A marker change starts a 10-minute stabilization window with five-second cadence. Regression evidence is captured before the service-recovery watch mutates the target.

## Strands boundary

Recovery Agent depends on `@tjxjnoobie/strands-bridge`, pinned to commit `69d27b147ee4f8bf0bfba43cbd0668a1ca4dd868`, rather than directly on `@strands-agents/sdk`.

After deterministic recovery is exhausted:

```text
strict triage
  -> 1..3 bounded specialists
  -> synthesis
  -> strict restart_service|none planner
  -> veto-only critic
```

Malformed triage falls back to one service specialist. The critic may reject the existing bounded proposal but cannot add another action. Model output cannot select another target, approve a plan, or mutate a node.

## Human approval

```bash
export RECOVERY_APPROVAL_TOKEN='replace-with-a-separate-long-secret'
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

The approval socket is local and owner-only (`0600`). Wrong-token requests execute zero mutation. Valid approval re-checks dependencies, durably records approval intent when durability is enabled, executes exactly one target-bound typed action, and freshly verifies application/service health.

Production-grade identity attribution, approval expiry/revocation, and durable actor identity remain promotion gates; the current token proves authorization, not a complete accountable identity system.

## Postmortems

`incident_postmortem` accepts only resolved incidents. It supplies only that incident and its related plans to Strands and returns strict summary/root-cause/contributing-factor/recovery/prevention/confidence data. Unsupported causality must remain `unknown`.

## Validation evidence

Audited implementation head: `70063accc85d9774707321c038e67d3ba72fa6d1`.

GitHub fallback workflow run `34283436989` validates the renamed-bridge durability stack with:

- Node 22 networked dependency installation;
- full TypeScript typecheck, delegate/E2E tests, and production build;
- Java 25 / Gradle 9.7.1 Recovery state-authority tests through Tavall Database;
- a PostgreSQL 17 service;
- creation of the real npm tarball, including bundled state-authority launcher/JARs;
- install of that tarball into a clean npm consumer project;
- installed authority `ping` and `load` against PostgreSQL;
- installed `recovery-agent mcp` startup using bundled-authority auto-resolution;
- installed `recovery-agent demo` and explicit `SIMULATED DEMONSTRATION` label verification.

The product still does **not** claim physical MCP Inspector/current ChatGPT-host acceptance, an authorized real-model Recovery incident run through Strands, production remote-node transport, or an authorized production action demo.

## Remaining promotion gates

Recovery Agent remains Draft. Major remaining gates include:

- physical MCP Inspector/current supported host acceptance;
- authorized real-model Recovery invocation through `@tjxjnoobie/strands-bridge`;
- durable node-health/certificate/deployment-correlation state and retention rules;
- production identity-aware approval attribution, expiry, revocation, and audit identity;
- outbound node enrollment, mTLS, credential rotation, and production remote transport;
- Docker/Kubernetes/network/database/Minecraft adapters;
- typed recovery actions beyond systemd restart, including rollback/failover/drain/quarantine/reboot;
- physical authorized action -> execution -> resulting-state demo evidence.

## Development

```bash
npm install
npm run check
```

Building the distributable npm tarball also builds the Java state-authority runtime and therefore requires Java 25, Gradle 9.x, and access to the Tavall Database package dependency.

See `docs/recovery-agent/RECOVERY_AGENT_FINAL_DRAFT.md` for the owning design and validation contract.
