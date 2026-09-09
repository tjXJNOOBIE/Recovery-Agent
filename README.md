# Recovery Agent

Recovery Agent is a control-host recovery runtime for Linux services. AI stays on the control host; production machines expose only narrow typed health and recovery operations. ChatGPT, Claude, Codex, or another MCP host can inspect incidents, run bounded recovery, create semantic watches, and review evidence without receiving arbitrary shell or approval authority.

**Agents for Humans track:** Professional

> **Current status:** Draft E2E foundation. Deterministic service recovery, application probes, Linux/node/certificate/deployment watches, Recovery Readiness, semantic service watches, dependency-aware rolling recovery budgets, bounded Strands investigation/planning/critic/postmortem roles, accountable local operator principals, restart-safe schema-v2 control-state durability, opt-in terminal-history retention, and packaged control-host installation are implemented. GitHub fallback validation physically exercises the Node 22 product, Java 25 state authority, PostgreSQL 17 durability, a clean npm consumer install, bundled authority discovery, installed MCP startup, and the labeled demo. Production remote transport, authorized real-model Recovery validation, broader production actions/adapters, and current-host/Inspector acceptance remain promotion gates.

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
              -> persist candidate
              -> activate deterministic recurring execution
          -> Strands triage -> specialists -> synthesis
          -> strict restart_service|none planner
          -> veto-only critic
          -> target-bound pending plan
          -> resolved-only postmortem

control-host human
  -> recovery-agent approve/reject
      -> owner-only Unix socket (0600)
          -> named principal credential from environment-only secret
          -> verified operator identity
          -> dependency re-check
          -> durable approval/rejection audit
          -> one already-bound typed action when approved
          -> fresh verification + durable outcome

control-host durability
  -> RecoveryDurableStateCoordinator
      -> optional terminal-history retention policy
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
export RECOVERY_STATE_JDBC_URL='jdbc:postgresql://127.0.0.1:5432/recovery'
export RECOVERY_STATE_DB_USERNAME='recovery'
export RECOVERY_STATE_DB_PASSWORD='replace-me'
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

Durability is optional for local development but is the restart-safe control-host path. The TypeScript runtime never connects directly to PostgreSQL. It talks over strict newline-delimited stdio to a product-specific Java 25 authority built on Tavall Database.

Schema v2 durably owns:

- service recovery incidents and timelines;
- typed recovery plans and statuses;
- rolling automatic restart-attempt history;
- semantic service-watch definitions;
- append-only Recovery audit history;
- node-health incident history;
- certificate incident history;
- deployment incident history;
- deployment baseline, marker, and stabilization state.

Legacy schema v1 snapshots remain readable. Both Java and TypeScript normalize v1 to safe schema-v2 defaults, and all new authority commits use schema v2.

Transient scheduler pulse bookkeeping stays process-local on purpose. Routine timer activity such as every `lastStartedAt` value is not durable business state and does not cause PostgreSQL churn simply because a timer fired.

Deployment markers and stabilization context survive control-host restart, temporary deployment-evidence unavailability, and node outages. A deployment change observed after an outage therefore cannot be mistaken for an innocent first baseline.

The authority uses a monotonic application revision separate from Hibernate's internal optimistic-lock version. Stale revisions fail closed, audit history cannot be rewritten or truncated, and local checkpoints are serialized so concurrent Recovery work shares one ordered authority revision stream.

### Durable terminal-history retention

Destructive durable cleanup is **off by default**. Operators may opt in with control-host configuration:

```json
{
  "durableRetention": {
    "terminalHistoryDays": 90,
    "terminalHistoryPerTarget": 200
  }
}
```

Retention is a Recovery domain policy applied to the candidate schema-v2 snapshot **before every authority commit**. Tavall Database and the Java authority still own persistence mechanics; neither invents Recovery cleanup rules.

The policy may prune only resolved/terminal historical service incidents, their fully terminal plans, resolved node-health incidents, resolved certificate incidents, and resolved deployment incidents. A service incident and all related plans are one referential retention unit, and its age uses the latest terminal timestamp from the incident or any related plan. A unit becomes eligible when it exceeds either the configured age ceiling or the per-target count ceiling.

Unresolved, recovering, dependency-blocked, approval-required, human-required, pending-approval, or approved state is never eligible. Current semantic watch definitions, rolling restart-attempt state, current deployment marker/stabilization causality, and the entire audit history remain durable. If a resolved deployment incident is pruned, only the obsolete incident reference is removed from current deployment state.

Audit history is intentionally never pruned under schema v2. The first successful commit that removes newly eligible history appends a `retention_cleanup` audit event. A failed authority commit records no cleanup as committed, and later checkpoints retry safely without duplicating cleanup audit entries for identities already pruned during that control-host generation.

Retention bounds PostgreSQL authority state immediately. Terminal records already loaded by the current TypeScript process may remain visible in its in-memory inspection surfaces until that process restarts. Every subsequent durable checkpoint re-applies the policy, so those records cannot be resurrected into PostgreSQL. This avoids mutating unrelated live state merely to make historical UI output disappear sooner.

### Write-ahead and causal mutation safety

Recovery Agent persists mutation intent **before** an external restart is allowed:

```text
unhealthy target
  -> update incident / spend automatic restart slot
  -> durable checkpoint
      -> failure: execute zero restart; latch mutations disabled
      -> success: execute one typed restart
          -> fresh verification
          -> durable outcome checkpoint
```

Node-health, certificate, and deployment causal state is also checkpointed before the service-recovery mutation path. If that causal checkpoint fails, the same mutation latch prevents the subsequent restart. Routine unchanged observations do not generate authority commits solely because a watch interval elapsed.

The same write-ahead rule applies to operator-approved recovery: authenticated approval intent must durably commit before the bound restart executes. A failed approval-intent checkpoint executes zero node mutation.

Semantic watch mutation is transactional with scheduling:

```text
compile candidate
  -> persist candidate
      -> activate deterministic scheduler
```

Create/update/remove operations are serialized. A failed semantic-watch checkpoint leaves both the durable definition and scheduler at the previously committed baseline.

## Semantic service watches

Operators can create or update recurring service-recovery watches using natural language. Strands compiles the request once into a configured target plus bounded interval. Recurring execution then calls the normal deterministic `recoverService()` path without further model calls.

The compiler may choose only an already-configured node/service target and an interval from **10 seconds through 24 hours**. It cannot create URLs, ports, commands, credentials, arbitrary recovery actions, conditions, or infrastructure.

## Recovery Readiness and built-in watches

`recovery_readiness` classifies configured targets as `ready`, `limited`, `blocked`, or `unreachable` using the same policy, rolling budget, dependency, plan, and incident state used by execution. It is read-only and runs automatically every five minutes.

Built-in watch order is:

```text
node -> certificate -> deployment -> service recovery -> readiness
```

Linux node evidence covers memory, swap, filesystem bytes/inodes, root read-only state, load per CPU, uptime, and request-midpoint clock drift. Certificate watches evaluate configured TLS targets without treating invalid certificates as trusted. Deployment correlation hashes configured marker files and carries marker/stabilization causality across restart and outages.

## Recovery safety

- Same-target concurrent recovery shares one in-flight operation.
- Approved recovery and automatic recovery share the per-target operation gate.
- Unhealthy dependencies block downstream mutation and consume zero restart budget.
- `health_sweep` orders dependencies before dependents.
- `pending_approval` suppresses duplicate automatic recovery/plans.
- `human_required` suppresses repeated mutation/Strands loops until verified external recovery.
- Successful automatic restarts consume the rolling budget too.
- Every node mutation is followed by fresh deterministic verification.
- An approved action whose result is lost during control-host crash becomes execution-outcome-unknown/human-required rather than being replayed blindly.
- A fresh healthy inspection after uncertain execution resolves the incident without another restart.
- One unreachable node does not hide the reachable fleet.
- Durable retention never prunes unresolved/in-doubt state or the append-only audit trail.

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

Named approval principals are configured by identity plus the environment-variable name holding their secret:

```json
{
  "approvalPrincipals": [
    {
      "id": "primary-operator",
      "tokenEnvironmentVariable": "RECOVERY_APPROVAL_TOKEN_PRIMARY",
      "expiresAt": "2027-01-01T00:00:00Z"
    }
  ]
}
```

Secrets remain environment-only. The operator CLI composes its local credential from:

```bash
export RECOVERY_APPROVAL_ACTOR='primary-operator'
export RECOVERY_APPROVAL_TOKEN='replace-with-that-principal-secret'
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

The approval socket is local and owner-only (`0600`). The verified principal, not caller-supplied audit text, becomes the durable approval/rejection actor. Principals may expire or be revoked. When named principals exist, anonymous legacy-token authorization is disabled. Legacy shared-token mode remains only as a local fallback when no named principals are configured.

Startup fails closed if two currently active, non-expired principals resolve to the same secret value, preventing one credential holder from impersonating another merely by changing the `principal-id:` prefix. Revoked or already-expired principals do not create an active-secret collision because they cannot authorize.

Valid approval re-checks dependencies, durably records authenticated approval intent, executes exactly one target-bound typed action, and freshly verifies application/service health. If the approval durability checkpoint fails, no node mutation occurs.

## Postmortems

`incident_postmortem` accepts only resolved incidents. It supplies only that incident and its related plans to Strands and returns strict summary/root-cause/contributing-factor/recovery/prevention/confidence data. Unsupported causality remains `unknown`.

## Validation evidence

Audited retention implementation head: `1c32e9a591b067de849130d14f7544f406082a32`.

GitHub fallback workflow run `34392908758` (#20) passed all three jobs on that head:

- Node 22.23.2 dependency installation, strict typecheck, **129/129 TypeScript tests**, and production build;
- Java 25 / Gradle 9.7.1 Recovery state-authority tests through Tavall Database;
- PostgreSQL 17 service;
- real npm tarball construction;
- clean npm consumer installation;
- bundled authority launcher/JAR verification;
- installed authority `ping`/schema-v2 `load` against PostgreSQL;
- installed `recovery-agent mcp` startup using bundled-authority resolution;
- installed `recovery-agent demo` execution;
- explicit `SIMULATED DEMONSTRATION` label assertion.

The 129-test suite includes regression evidence for v1→v2 normalization, deployment baseline continuity through outage, causal watch-state checkpointing before recovery mutation, semantic-watch transaction ordering, crash/concurrency reconciliation, duplicate active approval secrets, principal-prefix impersonation prevention, expiry/revocation, named-mode legacy bypass prevention, verified approval/rejection audit identity, zero approved node mutation when durability intent persistence fails, opt-in/default-off retention configuration, terminal-only retention, plan/incident referential retention, latest terminal timestamp selection, immutable audit preservation, no cleanup bookkeeping on failed commits, and prevention of durable history resurrection from still-live process memory.

This evidence was produced by GitHub fallback because the current Tavall Cloud environment resolved the exact Recovery source but its physical repository executor failed before process launch with `STALE_VERSION`, and restored service-console sockets were unavailable. No Tavall-local test execution is claimed for this head.

## Remaining promotion gates

Recovery Agent remains Draft. Major remaining gates are:

- physical MCP Inspector/current supported host acceptance;
- authorized real-model Recovery invocation through `@tjxjnoobie/strands-bridge`;
- outbound production node enrollment, mTLS, credential rotation, and remote transport;
- broader production adapters/actions where product scope requires them;
- physical authorized production action -> execution -> resulting-state evidence.

## Development

```bash
npm install
npm run check
```

Building the distributable npm tarball also builds the Java state-authority runtime and therefore requires Java 25, Gradle 9.x, and access to the Tavall Database package dependency.

See `docs/recovery-agent/RECOVERY_AGENT_FINAL_DRAFT.md` for the owning design and validation contract.
