# Recovery Agent Final Draft

> **Status:** Working E2E foundation / Draft promotion state  
> **Document type:** Final Draft / proposed product and technical contract  
> **Source of truth for:** Recovery Agent product policy, deterministic recovery, node/control protocol, primary durability model, watch behavior, Strands boundary, MCP exposure, and approval boundary  
> **Must not define:** a second Strands framework, arbitrary remote shell execution, generic replacements for Tavall-owned infrastructure, or capabilities not supported by implementation evidence  
> **Shared agent runtime:** `@tjxjnoobie/strands-bridge` at `69d27b147ee4f8bf0bfba43cbd0668a1ca4dd868`  
> **MCP server runtime:** `@modelcontextprotocol/server` v2

## About

Recovery Agent is a control-host reliability agent for Linux services. AI runs away from production nodes; small node agents expose bounded deterministic observation and typed recovery actions. The system is designed to recover known safe failures, use Strands for ambiguous diagnosis/planning, and require a human boundary for elevated actions.

> **Deterministic software observes, authorizes, budgets, orders, executes, persists mutation intent, and verifies. Strands interprets, investigates, plans, critiques, compiles bounded intent, and explains.**

AI is not the mutation or authorization boundary.

## Ownership Rules

Recovery Agent owns:

- node/service composition and product-specific recovery policy;
- deterministic health evaluation, dependency ordering, rolling recovery budgets, and suppression;
- service incidents, typed recovery plans, semantic service-watch definitions, and Recovery audit events;
- built-in node/certificate/deployment/readiness watches;
- product-specific Strands prompts/parsers/orchestration;
- human approval protocol and local approval socket;
- product-specific Java durable-state authority and its typed stdio protocol;
- demo scenarios and simulation labeling.

Connected systems retain their own responsibilities:

- `@tjxjnoobie/strands-bridge` owns shared Strands lifecycle/MCP integration behavior;
- Tavall Database owns PostgreSQL/JPA provider mechanics, transaction lifecycle, flush/rollback, and persistence implementation;
- production service managers own their actual service lifecycle;
- future production enrollment/identity infrastructure owns remote node identity and credential lifecycle.

Recovery Agent must not create a general TypeScript database/repository/cache framework, expose normal arbitrary shell execution, or let a model authorize its own recovery action.

## Technical Structure

```text
MCP host
  -> Recovery MCP stdio server
      -> RecoveryControlRuntime
          -> fleet inspection / Recovery Readiness
          -> RecoveryOperationGate
          -> dependency ordering and suppression
          -> rolling automatic restart budget
          -> RecoveryDurabilityCheckpointBarrier
          -> node HTTP gateways
              -> fixed SystemdNodeServiceRuntime
                  -> fixed HTTP/TCP app probes
                  -> deployment marker evidence
              -> LinuxNodeResourceProbe
              -> fixed NodeCertificateProbe
          -> RecoveryWatchCoordinator
              node -> certificate -> deployment -> service recovery -> readiness
          -> semantic service-watch compiler
              Strands once -> strict configured target/interval -> deterministic scheduler
          -> bounded Strands investigation graph
              triage -> 1..3 specialists -> synthesis
              -> restart_service|none planner
              -> veto-only critic
          -> resolved-only Strands postmortem

control-host human
  -> approve/reject CLI
      -> owner-only Unix socket (0600)
          -> separate approval token
          -> dependency re-check
          -> durable approval intent
          -> one typed action
          -> fresh verification

primary durable state
  -> RecoveryDurableStateCoordinator
      -> strict RecoveryStateAuthorityProcessClient
          -> Java 25 Recovery state authority
              -> Tavall Database
                  -> PostgreSQL
```

## Node Boundary

The node server exposes authenticated typed operations including:

```text
GET  /v1/node
GET  /v1/services/:serviceId
POST /v1/services/:serviceId/restart
GET  /v1/certificates
```

Public service IDs map to fixed configured systemd units. Remote/model callers cannot supply unit names, shell commands/arguments, app-health URLs/ports, certificate targets, or deployment marker paths.

The current node HTTP transport defaults to loopback and a per-node Bearer secret from environment configuration. Public Internet deployment is not claimed. Outbound enrollment, mTLS, rotation, and production remote transport remain required.

### Service and application health

A configured service owns one fixed systemd unit plus optional fixed HTTP(S)/TCP application checks. Process existence is not enough when application checks exist. A running unit with a failed configured application check is unhealthy.

### Linux node evidence

`LinuxNodeResourceProbe` reads without arbitrary shell execution from `/proc/meminfo`, Node OS APIs, `statfs`, and `/proc/self/mountinfo`. Evidence includes memory, swap, one-minute load per CPU, uptime, root filesystem byte/inode use, and root read-only state.

### Certificate evidence

Fixed TLS targets expose reachability, authorization state, validity window/days remaining, subject, issuer, fingerprint, and errors. The probe may observe an invalid certificate with peer verification disabled only so failure evidence can be collected; `authorized=false` remains explicit and is never treated as trust.

### Deployment evidence

An optional fixed `deploymentMarkerFile` produces SHA-256/timestamp evidence only. Contents and path are not returned to remote/model callers.

## Deterministic Recovery Flow

```text
recover node/service
  -> coalesce same-target in-flight work
  -> pending approval / human-required suppression check
  -> fresh service + application inspection
      -> healthy: return / resolve prior suppression when appropriate
  -> dependency health gate
      -> unhealthy prerequisite: dependency_blocked, zero restart
  -> restart policy + rolling automatic budget
      -> no safe attempt: investigate/escalate
      -> safe attempt available:
          -> record incident + consume automatic slot in runtime state
          -> durable write-ahead checkpoint when durability is enabled
              -> checkpoint failure: zero node mutation + mutation latch disabled
              -> checkpoint success: one typed restart
          -> fresh deterministic verification
          -> durable outcome checkpoint
          -> repeat only while policy + rolling budget allow
  -> deterministic path exhausted
      -> Strands triage/specialists/synthesis
      -> strict bounded planner
      -> veto-only critic
      -> no accepted proposal: human_required
      -> accepted restart_service: pending_approval
```

A mutation response is never proof of recovery. Fresh inspection is mandatory after mutation.

## Rolling Automatic Restart Budget

`maxRestartAttempts` is a rolling automatic ceiling, not a fresh allowance per watch cycle. The default window is 600 seconds. Successful restarts consume slots too.

When durability is enabled, restart-attempt history is restored before MCP/watches are exposed and is committed before an automatic restart can execute. A control-host restart therefore does not reset the automatic allowance.

## Dependency Gate

Configuration rejects unknown dependency targets, duplicates, self-dependencies, and cycles. Unhealthy/unreachable dependencies block downstream mutation with zero restart-budget use. `health_sweep` orders prerequisites before dependents. Approved recovery re-checks dependencies immediately before mutation.

## Suppression and Concurrency

- same-target recovery shares one in-flight operation;
- `pending_approval` suppresses duplicate automatic mutation/plans;
- `human_required` suppresses repeated mutation/Strands loops until verified external recovery;
- `dependency_blocked` suppresses dependent mutation while prerequisites remain unhealthy;
- durable checkpoints are serialized so concurrent target recovery shares one monotonic authority revision stream.

## Built-in Watch Surface

Automatic order is:

```text
node -> certificate -> deployment -> service recovery -> readiness
```

### Linux Node Watch

Read-only evidence covers memory, swap, root byte/inode pressure, root read-only state, normalized load, uptime, and request-midpoint clock drift. Defaults are 92% memory, 80% swap, 90% root bytes, 90% root inodes, 2.0 load/CPU, writable root, and <=30 seconds clock drift.

Node pressure can open/resolve node-health incidents but cannot automatically reboot, drain, destroy, or set time.

### Certificate Watch

TLS targets run every six hours by default. Warning begins at <=30 days remaining; critical at <=7 days or authorization failure. Certificate incidents are independent of service restart budget.

### Deployment Watch

A changed deployment marker starts a 10-minute stabilization window with five-second cadence. New-deployment + unhealthy-service evidence is recorded before service recovery mutates the target.

### Service Watch

Service watches call the same `recoverService` path used by MCP and therefore inherit dependency gates, rolling budgets, suppression, durability, Strands escalation, and fresh verification.

### Recovery Readiness

`recovery_readiness` classifies each configured service as `ready`, `limited`, `blocked`, or `unreachable` using the same live policy/budget/dependency/incident/plan state. It is read-only and defaults to a five-minute built-in cadence.

## Semantic Service Watches

```text
natural-language operator request
  -> Strands compilation once
  -> strict proposal { nodeId, serviceId, intervalSeconds, rationale }
  -> configured-target validation
  -> deterministic interval override
  -> recurring recoverService() without model calls
```

Rules:

- Strands is invoked only on `watch_create`/`watch_update`;
- target must already exist in control configuration;
- interval is an integer from 10 through 86,400 seconds;
- model output cannot include URLs, ports, commands, credentials, arbitrary conditions/actions, or new infrastructure;
- one semantic override may exist per service target;
- update cannot silently retarget a watch;
- remove restores the configured built-in interval or removes a dynamic-only watch;
- recurring execution and `watch_run` do not invoke Strands.

When durable state is enabled, semantic definitions restore before watch scheduling/MCP exposure. A failed semantic-watch checkpoint restores the previous in-memory definitions because no external node effect has yet occurred.

## Strands Reasoning Boundary

Recovery Agent consumes `@tjxjnoobie/strands-bridge`, not `@strands-agents/sdk` directly.

After deterministic exhaustion:

```text
strict triage
  -> 1..3 unique domains
      service | application | dependency | deployment | node | network
  -> synthesis
  -> strict planner { action: restart_service|none, rationale }
  -> veto-only critic
```

Malformed triage falls back to one service specialist. Specialist fan-out is capped at three. The planner cannot select a target. The critic can only accept/reject the existing bounded proposal; it cannot add actions. Critic rejection/failure creates no plan and fails closed to human intervention.

## Human Approval Boundary

When `RECOVERY_APPROVAL_TOKEN` is configured, the control host creates an owner-only local Unix socket (`0600`):

```bash
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

Approval/rejection do not exist on model-facing MCP. Wrong-token requests execute zero mutation. A valid approval re-checks dependencies and may execute exactly one already-bound restart.

When durability is enabled, plan approval/incident intent must commit before the approved restart executes. Verification/failure outcome is checkpointed afterward. A checkpoint failure permits zero restart and latches subsequent mutation intent disabled in the current process.

The current shared token is an authorization boundary, not a complete production identity system. Accountable actor identity, attribution, expiry, and revocation remain promotion gates.

## Data Model and Storage

### Durable primary control state

The product-specific Java authority owns schema-v1 Recovery snapshots through Tavall Database/PostgreSQL:

- service incidents and timelines;
- recovery plans and status/outcome;
- semantic service-watch definitions;
- automatic restart attempts;
- append-only audit entries.

The public durable revision is monotonic and separate from Hibernate's private optimistic-lock version. Stale revisions fail closed. Existing audit entries cannot be removed or rewritten.

The TypeScript process never owns a PostgreSQL connection. It communicates through strict line-delimited JSON over stdin/stdout. The authority exposes `ping`, `load`, and optimistic `commit` only; database credentials are environment-only.

### Process-local state still awaiting promotion

The following remain process-local and are not yet restart-safe authority:

- node-health incidents/watch runtime state;
- certificate incidents/watch runtime state;
- deployment-correlation incidents/watch runtime state;
- transient scheduler timestamps and due-run bookkeeping.

These must extend the same product-owned durability boundary rather than creating new generic TypeScript stores.

## Durable Startup and Failure Behavior

When `RECOVERY_STATE_JDBC_URL` is configured in a packaged Linux/macOS install, the CLI resolves the bundled Java authority automatically. `RECOVERY_STATE_AUTHORITY_COMMAND` can override it; Windows currently requires an explicit command.

Startup ordering is:

```text
read control config
  -> build deterministic runtime (surfaces still hidden)
  -> start/load state authority
  -> strictly validate durable snapshot
  -> restore incidents/plans/restart attempts/semantic watches
  -> bind durability barrier
  -> commit control_start audit checkpoint
  -> expose approval socket / watches / MCP
```

If hydration or the startup checkpoint fails, the public operational surfaces are not exposed. Cleanup preserves the original error and aggregates cleanup failures when necessary.

During normal operation, the first failed durability checkpoint permanently latches mutation-intent operations off for that process. Read-only inspection remains available. This prevents the runtime from continuing node mutations after losing authoritative write-ahead state.

## Packaging

Published/packaged npm artifacts include:

- compiled TypeScript `dist/`;
- Java state-authority launcher;
- the state-authority runtime dependency JARs;
- examples and documentation.

End users running the package need Java 25 for durability but do not need Gradle or Tavall package credentials. Building the distributable artifact from source resolves Tavall Database and therefore requires the appropriate build environment/credentials.

## MCP Surface

Model-facing operations are:

```text
fleet_status
recovery_readiness
node_inspect
service_inspect
service_recover
health_sweep
watch_list
watch_run
watch_create
watch_update
watch_remove
incident_list
incident_inspect
incident_postmortem
recovery_plan_list
recovery_plan_inspect
```

Approval/rejection are intentionally absent.

## Incident Postmortems

`incident_postmortem` accepts only resolved incidents. Unresolved incidents are rejected before creating a Strands runtime. Only plans belonging to the incident are included. The strict result contains summary, root cause, contributing factors, recovery, prevention, and confidence; unsupported root cause remains `unknown`.

## Demo Truthfulness

`recovery-agent demo` is visibly labeled `SIMULATED DEMONSTRATION`. Simulated model/host behavior is not presented as physical production evidence. Elevated plans are never silently auto-approved.

## Validation Requirements and Current Evidence

Audited implementation head: `70063accc85d9774707321c038e67d3ba72fa6d1`.

GitHub fallback workflow run `34283436989` physically validates the current renamed-bridge durability stack:

### TypeScript E2E

- Node 22;
- networked dependency install, including `@tjxjnoobie/strands-bridge` at the pinned commit;
- strict TypeScript check;
- complete delegate/E2E suite;
- production build.

### Java durable state authority

- Java 25;
- Gradle 9.7.1;
- Tavall Database dependency path;
- H2 PostgreSQL-mode authority tests covering load/commit revisions, stale revision failure, audit-prefix immutability, and strict protocol behavior.

### Packaged control-host E2E

- PostgreSQL 17 service;
- real npm tarball creation;
- install into a clean consumer directory;
- verification that bundled authority launcher and runtime JARs are present;
- installed authority `ping` and `load` against PostgreSQL;
- installed `recovery-agent mcp` startup using bundled-authority auto-resolution;
- installed `recovery-agent demo`;
- explicit `SIMULATED DEMONSTRATION` label assertion.

Delegate coverage additionally proves:

- strict durable snapshot parsing and restore invariants;
- multiple-pending-plan and invalid semantic-target rejection;
- concurrent local checkpoints produce one ordered revision stream;
- stale revision does not advance local revision/audit;
- durability failure permanently latches mutations disabled;
- failed write-ahead checkpoint executes zero automatic restarts;
- failed write-ahead checkpoint executes zero approved restarts;
- semantic-watch mutation rolls back when persistence fails before external effects.

Still intentionally unclaimed:

- physical MCP Inspector/current supported ChatGPT host acceptance;
- a Recovery incident using an authorized real model/provider through Strands;
- production remote-node transport/security;
- production identity-attributed approval lifecycle;
- physical authorized production action -> execution -> resulting-state demo evidence.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. Remaining gates include:

- physical official MCP Inspector/current-host acceptance;
- authorized real-model Recovery invocation through the current Strands bridge;
- durable node-health/certificate/deployment-correlation state, retention, and cleanup;
- production identity-aware approval attribution, expiry, revocation, and durable actor identity;
- outbound node enrollment, mTLS, credential rotation, and production remote transport;
- Docker/Kubernetes/network/database/Minecraft adapters;
- typed actions beyond systemd restart, including rollback/failover/drain/quarantine/reboot;
- physical authorized action -> execution -> resulting-state demo evidence.

## Final Invariants

- AI does not run on production nodes.
- Deterministic software owns target binding, health, dependency gates, rolling budgets, mutation, write-ahead persistence, and fresh verification.
- A running process is not sufficient application health when app probes exist.
- Callers cannot choose node-local units/probe targets/TLS targets/deployment marker paths.
- One unreachable node does not erase the reachable fleet.
- Node pressure/filesystem/clock/certificate issues do not automatically become destructive actions.
- Dependency failure does not trigger blind downstream restarts.
- Flapping services do not receive infinite automatic restarts.
- Same-target recovery is coalesced.
- Pending approval/human escalation suppress automatic retry loops.
- Semantic intent is compiled once and recurring execution is deterministic.
- Model plans cannot choose targets or approve themselves.
- Durability loss blocks mutation rather than allowing unrecorded external effects.
- Arbitrary shell execution is not a normal capability.
- Demo simulation remains explicitly labeled.
- Draft status remains until the remaining physical runtime/security/review gates are satisfied.
