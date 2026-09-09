# Recovery Agent Final Draft

> **Status:** Working E2E foundation / Draft promotion state  
> **Document type:** Final Draft / proposed product and technical contract  
> **Source of truth for:** Recovery Agent product policy, deterministic recovery, node/control protocol, durable control-state model, retention policy, watch behavior, Strands boundary, MCP exposure, and approval boundary  
> **Must not define:** a second Strands framework, arbitrary remote shell execution, generic replacements for Tavall-owned infrastructure, or capabilities not supported by implementation evidence  
> **Shared agent runtime:** `@tjxjnoobie/strands-bridge` at `69d27b147ee4f8bf0bfba43cbd0668a1ca4dd868`  
> **MCP server runtime:** `@modelcontextprotocol/server` v2

## About

Recovery Agent is a control-host reliability agent for Linux services. AI runs away from production nodes; small node agents expose bounded deterministic observation and typed recovery actions. The system is designed to recover known safe failures, use Strands for ambiguous diagnosis/planning, and require a human boundary for elevated actions.

> **Deterministic software observes, authorizes, budgets, orders, executes, persists mutation intent, applies durable retention policy, and verifies. Strands interprets, investigates, plans, critiques, compiles bounded intent, and explains.**

AI is not the mutation or authorization boundary.

## Ownership Rules

Recovery Agent owns:

- node/service composition and product-specific recovery policy;
- deterministic health evaluation, dependency ordering, rolling recovery budgets, and suppression;
- service, node-health, certificate, and deployment incident state;
- typed recovery plans and semantic service-watch definitions;
- Recovery audit events and deployment-correlation state;
- product-specific durable terminal-history retention policy;
- built-in node/certificate/deployment/readiness watches;
- product-specific Strands prompts/parsers/orchestration;
- human approval protocol, named approval-principal verification, and the local approval socket;
- product-specific Java durable-state authority and its typed stdio protocol;
- demo scenarios and simulation labeling.

Connected systems retain their own responsibilities:

- `@tjxjnoobie/strands-bridge` owns shared Strands lifecycle/MCP integration behavior;
- Tavall Database owns PostgreSQL/JPA provider mechanics, transaction lifecycle, flush/rollback, and persistence implementation;
- production service runtimes own their actual service lifecycle;
- future production enrollment infrastructure owns remote node identity, mTLS, and credential lifecycle.

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
              Strands once -> strict target/interval
              -> persist candidate
              -> deterministic scheduler
          -> bounded Strands investigation graph
              triage -> 1..3 specialists -> synthesis
              -> restart_service|none planner
              -> veto-only critic
          -> resolved-only Strands postmortem

control-host human
  -> approve/reject CLI
      -> owner-only Unix socket (0600)
          -> named principal-id:secret credential
          -> verified identity + expiry/revocation checks
          -> durable approval/rejection audit
          -> dependency re-check
          -> one typed action when approved
          -> fresh verification

durable control state
  -> RecoveryDurableStateCoordinator
      -> optional RecoveryDurableRetentionService
          -> terminal-history candidate filter
          -> audit never pruned
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

Fixed TLS targets expose reachability, authorization state, validity window/days remaining, subject, issuer, fingerprint, and errors. Invalid certificates may be inspected for evidence, but `authorized=false` remains explicit and is never treated as trust.

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
          -> durable write-ahead checkpoint
              -> retention filters only terminal historical candidate state
              -> checkpoint failure: zero node mutation + mutation latch disabled
              -> checkpoint success: one typed restart
          -> fresh deterministic verification
          -> durable outcome checkpoint
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

## Suppression, Crash Safety, and Concurrency

- same-target automatic recovery shares one in-flight operation;
- approved execution and automatic recovery share the per-target operation gate;
- `pending_approval` suppresses duplicate automatic mutation/plans;
- `human_required` suppresses repeated mutation/Strands loops until verified external recovery;
- `dependency_blocked` suppresses dependent mutation while prerequisites remain unhealthy;
- durable checkpoints are serialized so concurrent work shares one monotonic authority revision stream;
- a durably approved action whose execution result is lost across control-host crash becomes human-required/execution-outcome-unknown rather than being replayed;
- an interrupted `recovering` incident becomes human-required;
- a fresh healthy inspection after uncertain execution resolves state without another restart;
- durable plans must match their incident target, and incidents/plans/restart attempts must target configured Recovery services;
- authority revision and authority-owned committed snapshot are reconciled together;
- retention never deletes unresolved/in-doubt state or audit history;
- retention filtering happens on the authority candidate rather than by overwriting unrelated concurrent live runtime state.

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

A changed deployment marker starts a 10-minute stabilization window with five-second cadence. New-deployment + unhealthy-service evidence is recorded before service recovery mutates the target. Durable marker/baseline/stabilization state survives control-host restart, temporary evidence unavailability, and node outages, so a later marker change cannot masquerade as an innocent first baseline.

### Service Watch

Service watches call the same `recoverService` path used by MCP and therefore inherit dependency gates, rolling budgets, suppression, durability, Strands escalation, and fresh verification.

### Recovery Readiness

`recovery_readiness` classifies each configured service as `ready`, `limited`, `blocked`, or `unreachable` using the same live policy/budget/dependency/incident/plan state. It is read-only and defaults to a five-minute built-in cadence.

### Causal durability before service mutation

Node-health, certificate, and deployment causal state is checkpointed after observation and before the service-recovery mutation path. If that checkpoint fails, the mutation latch prevents subsequent service mutation. Routine unchanged observations do not produce database writes merely because a scheduler interval fired.

## Semantic Service Watches

```text
natural-language operator request
  -> Strands compilation once
  -> strict proposal { nodeId, serviceId, intervalSeconds, rationale }
  -> configured-target validation
  -> persist candidate definition
  -> activate deterministic interval override
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

Create/update/remove are serialized. The system compiles a candidate, persists it, and only then activates the deterministic scheduler. A failed checkpoint leaves definitions and scheduler at the previously committed baseline; an uncommitted AI-compiled watch is never activated.

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

Approval/rejection never exist on model-facing MCP. Named approval principals are configured without storing secret values:

```json
{
  "approvalPrincipals": [
    {
      "id": "primary-operator",
      "tokenEnvironmentVariable": "RECOVERY_APPROVAL_TOKEN_PRIMARY",
      "expiresAt": "2027-01-01T00:00:00Z"
    },
    {
      "id": "retired-operator",
      "tokenEnvironmentVariable": "RECOVERY_APPROVAL_TOKEN_RETIRED",
      "revoked": true
    }
  ]
}
```

The configured environment variables hold the secret values. The CLI composes a local authenticated credential from `RECOVERY_APPROVAL_ACTOR` and `RECOVERY_APPROVAL_TOKEN`, producing `principal-id:secret` for the owner-only Unix socket.

Properties:

- the authenticated principal is derived by credential verification, not a caller-supplied audit actor;
- approval/rejection audit records use the verified principal ID;
- principals may expire or be revoked;
- named-principal mode disables anonymous legacy-token authorization;
- the raw shared-token flow remains a legacy/local fallback only when no named principals exist;
- active, non-expired principals must resolve to distinct secret values even when they reference different environment-variable names;
- revoked/expired principals are excluded from that active-secret collision check because they cannot authorize;
- changing only the principal-id prefix cannot authenticate with another principal's credential.

A valid approval re-checks dependencies and may execute exactly one already-bound restart. Approval/incident intent must commit before execution. If that checkpoint fails, zero node mutation occurs and later mutation intent remains latched disabled. Rejection is also durably attributed to the verified principal.

## Data Model and Storage

### Durable schema v2 control state

The product-specific Java authority owns schema-v2 Recovery snapshots through Tavall Database/PostgreSQL:

- service recovery incidents and timelines;
- typed recovery plans and status/outcome;
- semantic service-watch definitions;
- automatic restart attempts;
- append-only audit entries;
- node-health incident history;
- certificate incident history;
- deployment incident history;
- deployment baseline, marker, and stabilization state.

Legacy schema v1 remains readable. The Java authority and TypeScript parser normalize v1 into safe schema-v2 defaults, while all new durable commits use v2.

The public durable revision is monotonic and separate from Hibernate's private optimistic-lock version. Stale revisions fail closed. Existing audit entries cannot be removed or rewritten.

The TypeScript process never owns a PostgreSQL connection. It communicates through strict line-delimited JSON over stdin/stdout. The authority exposes `ping`, `load`, and optimistic `commit` only; database credentials are environment-only.

### Durable terminal-history retention

Retention is an optional Recovery-domain policy and is disabled when `durableRetention` is absent:

```json
{
  "durableRetention": {
    "terminalHistoryDays": 90,
    "terminalHistoryPerTarget": 200
  }
}
```

The policy runs against the prospective schema-v2 snapshot before every authority commit. It does not connect to PostgreSQL and does not add another repository/database abstraction.

Eligible history:

- resolved service recovery incidents whose related plans are all terminal;
- related plans in `executed`, `rejected`, `failed`, or `superseded` state;
- resolved node-health incidents;
- resolved certificate incidents;
- resolved deployment incidents.

Never eligible:

- unresolved service incidents of any status;
- pending or approved plans;
- semantic watch definitions;
- rolling restart attempts;
- current deployment marker/stabilization causality;
- any audit entry.

Service incident + plan history is one referential unit. Its terminal age is the latest timestamp from the incident's final timeline event or any related terminal plan `updatedAt`. For each target, terminal units are newest-first. A unit is pruned if it exceeds the age ceiling **or** falls beyond the configured per-target count ceiling.

When a pruned resolved deployment incident is referenced by current deployment state, only that obsolete incident reference is removed. Marker/stabilization causality remains.

The first successful checkpoint in a control-host generation that removes newly eligible identities appends a `retention_cleanup` audit event containing category counts and explicitly stating that audit history is retained. Failed authority commits do not mark cleanup committed. Subsequent checkpoints do not repeatedly audit the same already-pruned identities for that generation.

Retention bounds the PostgreSQL authority snapshot immediately. Already-loaded terminal history may remain visible in the current TypeScript process until restart. This is deliberate: deleting only the durable candidate prevents historical state from being resurrected in PostgreSQL without racing or overwriting unrelated live state. Every later checkpoint applies the retention filter again.

Audit remains append-only and unpruned under schema v2. This is the intentional audit retention policy, not an omission.

### Intentionally transient state

Scheduler pulse bookkeeping is not durable domain authority. Due-run timestamps and equivalent timer bookkeeping remain process-local so routine cadence does not create meaningless database writes. Causal watch state and incident history are durable; timer implementation details are not.

## Durable Startup and Failure Behavior

When `RECOVERY_STATE_JDBC_URL` is configured in a packaged Linux/macOS install, the CLI resolves the bundled Java authority automatically. `RECOVERY_STATE_AUTHORITY_COMMAND` can override it; Windows currently requires an explicit command.

Startup ordering is:

```text
read control config
  -> build deterministic runtime (surfaces still hidden)
  -> resolve named approval principals and fail closed on invalid active credentials
  -> build optional retention policy
  -> start/load state authority
  -> strictly parse v1/v2 snapshot and normalize to v2
  -> restore incidents/plans/restart attempts/semantic watches
  -> restore node/certificate/deployment causal state
  -> reconcile interrupted/uncertain recovery state
  -> bind durability barrier
  -> build control_start candidate
  -> apply retention to terminal historical candidate state
  -> commit control_start + any retention_cleanup audit
  -> expose approval socket / watches / MCP
```

If hydration, approval-principal construction, retention validation, or the startup checkpoint fails, operational surfaces are not exposed. Cleanup preserves the original error and aggregates cleanup failures when necessary.

During normal operation, the first failed durability checkpoint permanently latches mutation-intent operations off for that process. Read-only inspection remains available. This prevents the runtime from continuing node mutations after losing authoritative write-ahead state.

## Packaging

Published/packaged npm artifacts include:

- compiled TypeScript `dist/`;
- Java state-authority launcher;
- state-authority runtime dependency JARs;
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

Audited retention implementation head: `1c32e9a591b067de849130d14f7544f406082a32`.

GitHub fallback workflow run `34392908758` (#20) passed all three jobs on that implementation head.

### TypeScript E2E

- Node 22.23.2;
- networked dependency install including the pinned `@tjxjnoobie/strands-bridge` source;
- strict TypeScript check;
- **129/129 tests passed**;
- production build.

Delegate coverage includes:

- schema-v1 normalization to schema-v2 defaults and strict v2 secondary-state parsing;
- deployment baseline continuity through node outage;
- causal watch-state checkpoint before service recovery mutation;
- semantic candidate persistence before scheduler activation and rollback to committed baseline on persistence failure;
- approval/automatic per-target concurrency safety and crash-state reconciliation;
- failed write-ahead checkpoint executes zero automatic restart;
- failed approval-intent checkpoint executes zero approved restart;
- named-principal legacy bypass prevention, expiry, revocation, duplicate-active-secret rejection, known-principal impersonation prevention, and verified approval/rejection audit identity;
- retention default-off/opt-in parsing and invalid-bound rejection;
- terminal-only retention with unresolved/nonterminal protection;
- referential incident+plan retention and latest terminal timestamp selection;
- audit preservation and deployment-causality preservation;
- failed-retention-commit rollback semantics;
- prevention of durable history resurrection from already-loaded process memory;
- no duplicate `retention_cleanup` audit for the same pruned identities during one process generation.

### Java durable state authority

- Java 25;
- Gradle 9.7.1;
- Tavall Database dependency path;
- state-authority persistence/protocol tests, including v1 migration to v2 and secondary-state persistence.

### Packaged control-host E2E

- PostgreSQL 17 service;
- real npm tarball creation;
- installation into a clean consumer directory;
- bundled authority launcher and runtime JAR verification;
- installed authority `ping` and schema-v2 `load` against PostgreSQL;
- installed `recovery-agent mcp` startup using bundled-authority auto-resolution;
- installed `recovery-agent demo`;
- explicit `SIMULATED DEMONSTRATION` label assertion.

The current Tavall Cloud catalog/environment was inspected first and a durable Recovery environment was resolved against the exact PR source. Physical Tavall repository execution could not start because the installed compatibility materializer returned `STALE_VERSION`, and restored service-console endpoints had no live socket. Therefore no Tavall-local UID/sudo or test execution is claimed for this implementation head; GitHub fallback validation is the physical execution evidence.

Still intentionally unclaimed:

- physical MCP Inspector/current supported ChatGPT-host acceptance;
- a Recovery incident using an authorized real model/provider through Strands;
- production remote-node enrollment/transport/security;
- physical authorized production action -> execution -> resulting-state evidence.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. Remaining gates include:

- physical official MCP Inspector/current-host acceptance;
- authorized real-model Recovery invocation through the current Strands bridge;
- outbound node enrollment, mTLS, credential rotation, and production remote transport;
- broader production adapters/actions where required by product scope;
- physical authorized production action -> execution -> resulting-state evidence.

## Final Invariants

- AI does not run on production nodes.
- Deterministic software owns target binding, health, dependency gates, rolling budgets, authorization verification, mutation, write-ahead persistence, durable retention, and fresh verification.
- A running process is not sufficient application health when app probes exist.
- Callers cannot choose node-local units/probe targets/TLS targets/deployment marker paths.
- One unreachable node does not erase the reachable fleet.
- Node pressure/filesystem/clock/certificate issues do not automatically become destructive actions.
- Dependency failure does not trigger blind downstream restarts.
- Flapping services do not receive infinite automatic restarts.
- Same-target approved and automatic recovery cannot race each other.
- Pending approval/human escalation suppress automatic retry loops.
- Semantic intent is compiled once, durably committed, and only then scheduled for deterministic recurring execution.
- Model plans cannot choose targets or approve themselves.
- Durable schema v1 remains migration-readable; new authority state is schema v2.
- Causal node/certificate/deployment state survives restart; transient scheduler pulses do not become durable noise.
- Approval audit identity comes from verified principal credentials, not caller-supplied actor text.
- Two active principals cannot share the same resolved secret.
- Retention is opt-in, terminal-only, and cannot prune unresolved/in-doubt state.
- Service incidents and their plans are retained/pruned as one referential unit.
- Current deployment causal state survives historical deployment-incident cleanup.
- Audit history is append-only and never pruned under schema v2.
- Failed durable cleanup commits do not count as cleanup.
- Already-loaded terminal history may remain visible until restart but cannot be resurrected into PostgreSQL.
- Durability loss blocks mutation rather than allowing unrecorded external effects.
- Arbitrary shell execution is not a normal capability.
- Demo simulation remains explicitly labeled.
- Draft status remains until the remaining physical runtime/security/review gates are satisfied.
