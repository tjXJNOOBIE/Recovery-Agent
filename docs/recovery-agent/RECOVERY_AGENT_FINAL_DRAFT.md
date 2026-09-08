# Recovery Agent Final Draft

> **Status:** Working E2E foundation / Draft promotion state  
> **Hackathon track:** Professional  
> **Shared agent runtime:** `@tjxjnoobie/custom-strands-bridge`  
> **MCP server runtime:** `@modelcontextprotocol/server` v2  
> **Owns:** Recovery Agent product policy, node/control protocol, deterministic recovery, built-in and semantic watches, incident/plan lifecycle, MCP exposure, and human approval boundary  
> **Must not define:** a second Strands framework, arbitrary remote shell execution, generic replacement infrastructure for Tavall-owned systems, or unverified production capabilities

## Product Contract

Recovery Agent keeps AI execution on a control host while small node agents expose bounded deterministic operations on machines that run services.

> **Deterministic software observes, authorizes, budgets, orders, executes, and verifies. Strands interprets, investigates, plans, critiques, compiles bounded intent, and explains.**

AI is never the mutation or authorization boundary.

## Current E2E Topology

```text
MCP host
  -> official MCP stdio server
      -> RecoveryControlRuntime
          -> partial-fleet inspection
          -> Recovery Readiness
          -> RecoveryOperationGate
          -> suppression barriers
          -> dependency health gate / ordered sweep
          -> node HTTP gateways
              -> NodeAgentHttpServer
                  -> fixed SystemdNodeServiceRuntime
                      -> fixed HTTP/TCP app probes
                      -> optional deployment marker evidence
                  -> LinuxNodeResourceProbe
                  -> fixed NodeCertificateProbe
          -> RecoveryWatchCoordinator
              -> node/resource/filesystem/clock watch
              -> certificate watch
              -> deployment correlation watch
              -> service recovery watch
              -> readiness watch
          -> semantic service-watch compiler
              -> Strands invoked once on create/update
              -> strict configured target + interval proposal
              -> deterministic watch override thereafter
          -> RecoveryOrchestrator
              -> rolling restart budget
              -> incident repository
              -> Strands triage/specialists/synthesis
              -> strict planner
              -> veto-only critic
              -> bounded pending plan
          -> resolved-only Strands postmortem

control-host human
  -> recovery-agent approve/reject
      -> owner-only Unix socket (0600)
          -> separate approval token
          -> dependency re-check
          -> exactly one target-bound typed action
          -> fresh systemd + application verification
```

## Ownership and Security Boundaries

Recovery Agent owns product-specific state and behavior:

- configured node/service composition;
- health snapshots and watch state;
- recovery policy and rolling automatic restart budgets;
- dependency ordering/blocking;
- service incidents, node-health incidents, certificate incidents, deployment-correlation incidents;
- typed recovery plans and approval lifecycle;
- deterministic verification;
- product-specific Strands prompts/parsers/orchestration;
- semantic service-watch definitions and override behavior;
- demo scenarios and simulation labeling.

Production node operations are narrow. The normal surface contains no arbitrary shell executor. Public service IDs map to configured systemd units. Remote/model callers cannot supply unit names, shell commands/arguments, health URLs or ports, TLS certificate targets, or deployment marker paths.

## Node Boundary

The node server currently exposes authenticated typed HTTP operations including:

```text
GET  /v1/node
GET  /v1/services/:serviceId
POST /v1/services/:serviceId/restart
GET  /v1/certificates
```

The node server defaults to loopback and uses a per-node Bearer secret from an environment variable. Public Internet deployment is not claimed. Production remote transport remains gated on outbound enrollment, mTLS, and credential rotation.

### Service health

A configured service has one fixed systemd unit and optional fixed HTTP(S)/TCP application checks. HTTP URL credentials are rejected. Probe hosts/ports/URLs are node configuration, not operation arguments. A running systemd unit with failed app checks remains unhealthy.

### Deployment evidence

A service may configure `deploymentMarkerFile`. Recovery Agent exposes only bounded SHA-256/timestamp evidence, not marker contents or path. Deployment evidence is informational and does not directly change service health.

### Linux node evidence

`LinuxNodeResourceProbe` reads without shell execution from `/proc/meminfo`, OS APIs, `statfs`, and `/proc/self/mountinfo`. Evidence includes memory, swap, load/CPU, uptime, root filesystem bytes/inodes, and root read-only state.

### Certificate evidence

Configured TLS targets contain fixed ID/host/port/SNI/timeout/thresholds. Evidence includes reachability, trust/authorization state, validity window/days remaining, subject, issuer, fingerprint, and errors. Invalid certificates may be observed with verification disabled only so their evidence can be inspected; `authorized=false` remains explicit and is never treated as trusted.

## Deterministic Recovery Flow

```text
recover node/service
  -> coalesce same-target in-flight operation
  -> pending approval?
      -> read-only fresh inspection
      -> remain approval_required or supersede if externally healthy
  -> human_required incident?
      -> read-only fresh inspection
      -> remain escalated or resolve if externally healthy
  -> inspect systemd + configured app probes
      -> healthy -> return
  -> dependencies healthy/reachable?
      -> no -> dependency_blocked, zero mutation
  -> restart allowed?
      -> no -> investigate/escalate
  -> rolling automatic restart budget available?
      -> no -> zero mutation, investigate/escalate
      -> yes -> consume slot -> typed restart -> fresh verification
          -> healthy -> resolve
          -> unhealthy -> repeat only while policy + rolling budget allow
  -> deterministic path exhausted
      -> Strands investigation graph
      -> strict bounded planner
      -> veto-only critic
      -> no accepted bounded proposal -> human_required
      -> accepted restart_service -> target-bound pending_approval plan
```

Mutation response is never proof of recovery. Fresh inspection after mutation is mandatory.

## Rolling Automatic Restart Budget

`maxRestartAttempts` is a rolling automatic ceiling, not a new allowance on every watch invocation. The default budget window is 600 seconds. Every actual automatic restart consumes one slot, including successful restarts. Exhausted budget executes zero restart before investigation/escalation.

The automatic ledger is process-local today. Durable budget authority remains a production promotion gate.

## Dependency Gate

Services may declare same-node or cross-node dependencies. Configuration rejects unknown targets, self-dependencies, duplicates, and cycles. Unhealthy/unreachable dependencies block dependent mutation, `health_sweep` orders prerequisites first, and approved execution re-checks dependency health immediately before mutation.

## Suppression and Concurrency Barriers

- Same-target concurrent recovery shares one active operation.
- `pending_approval` suppresses additional automatic mutation/incidents/plans until decision or verified external recovery.
- `human_required` suppresses repeated automatic mutation and Strands reinvocation until verified external recovery.
- `dependency_blocked` suppresses dependent mutation until prerequisites are freshly healthy.

## Partial-Fleet Inspection

`fleet_status` isolates node failures. Reachable nodes remain inspectable/recoverable when another gateway is unreachable, and explicit unreachable-node evidence is returned.

## Built-in Watch Surface

Combined automatic order is:

```text
node -> certificate -> deployment -> service recovery -> readiness
```

### Linux Node Watch

Read-only evidence covers memory, swap, root filesystem byte/inode pressure, root read-only state, normalized one-minute load, uptime, and midpoint-based node clock drift. Default limits are 92% memory, 80% swap, 90% root bytes, 90% root inodes, 2.0 load/CPU, writable root, and <=30 seconds drift.

The watch can open/update/resolve node-health incidents but cannot reboot, drain, destroy, or set system time.

### Certificate Watch

Fixed TLS targets are inspected every six hours by default. Warning begins at <=30 days remaining; critical at <=7 days or when TLS authorization fails. Certificate issues have their own incidents and never spend service restart budget.

### Deployment Watch

A deployment marker change starts a 10-minute stabilization window with five-second cadence. A changed marker plus unhealthy service evidence opens deployment-regression evidence before the service-recovery watch mutates the target.

### Service Watch

Configured service watches delegate to the same `recoverService` implementation used by MCP, inheriting systemd/app health, dependencies, rolling budgets, suppression, Strands escalation, and fresh verification.

### Recovery Readiness

`recovery_readiness` classifies each target as `ready`, `limited`, `blocked`, or `unreachable` using the same live policy, rolling budget, dependencies, plans, and incidents used by execution. The built-in readiness watch defaults to five minutes and is read-only.

## Semantic Service Watches

Semantic watches implement the product contract:

```text
natural-language operator request
  -> Strands compilation once
  -> strict semantic proposal
      { nodeId, serviceId, intervalSeconds, rationale }
  -> deterministic configured-target validation
  -> RecoveryWatchService interval override
  -> normal deterministic recoverService() on every due run
```

Rules:

- compilation happens only on `watch_create` and `watch_update`;
- recurring execution and `watch_run` never invoke the semantic compiler;
- node/service target must already exist in control configuration;
- interval must be an integer from 10 through 86,400 seconds;
- compiler output may contain only `nodeId`, `serviceId`, `intervalSeconds`, and `rationale`;
- URLs, ports, commands, credentials, conditions, recovery actions, new infrastructure, or arbitrary targets are not accepted;
- at most one semantic override exists per target;
- update cannot silently retarget an existing watch;
- remove restores the configured built-in watch interval when one exists;
- remove deletes the dynamic watch entirely when the service had no built-in watch.

Semantic watch definitions are process-local in the E2E foundation. A control-host restart loses them. Durable semantic-watch authority, migration, retention, and recovery remain production promotion gates and must use an appropriate owning persistence boundary rather than inventing a parallel general database layer in this product.

## Strands Reasoning Boundary

Recovery Agent consumes `@tjxjnoobie/custom-strands-bridge`, not `@strands-agents/sdk` directly.

After deterministic recovery exhaustion:

```text
strict triage
  -> 1..3 unique specialist domains
      service | application | dependency | deployment | node | network
  -> synthesis
  -> strict planner {action, rationale}
  -> veto-only critic
  -> deterministic plan creation only if accepted
```

Malformed triage safely falls back to one service specialist. Specialist fan-out is capped at three. The planner may propose only `restart_service` or `none`; model output cannot choose another target or provide commands/credentials. The critic can accept/reject the existing bounded proposal and cannot expand the action catalog. Critic rejection/failure creates no plan and fails closed to human intervention.

## Human Approval Boundary

When `RECOVERY_APPROVAL_TOKEN` is configured, the control process creates a per-user local Unix approval socket with mode `0600`.

```bash
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

Approval/rejection are absent from model-facing MCP. Wrong-token requests execute zero mutation. Valid approval re-checks dependencies, executes exactly one already-bound typed action, and performs fresh service/application verification.

## Incident Postmortems

`incident_postmortem` is read-only and accepts only an incident already marked `resolved`. Unresolved incidents are rejected before Strands runtime creation. Only plans belonging to that incident are included as evidence.

The strict result contains summary, root cause, contributing factors, recovery, prevention, and confidence. Unsupported causality must remain `unknown` rather than being invented.

## MCP Surface

Current model-facing tools:

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

## Current State Durability

Current service incidents, recovery plans, node-health incidents, certificate incidents, deployment incidents, semantic-watch definitions, automatic restart budgets, and watch runtime state are process-local. They are explicitly not durable authority.

Durable authority requires an owning persistence boundary with restart recovery, migration/versioning, retention/cleanup, and audit semantics.

## Demo Truthfulness

`recovery-agent demo` remains visibly labeled `SIMULATED DEMONSTRATION`. Simulated model/host behavior is not presented as physical product evidence and elevated plans are never auto-approved.

## Validation Evidence

Earlier foundation validation completed on Node 22.16.0 / TypeScript 5.8.3 with 30/30 branch delegate/E2E tests, strict TypeScript, production build, and package dry-run before later slices.

Later focused/dependency-free/live validation covers rolling budgets, dependency topology/blocking/order, partial-fleet isolation, Linux resources/filesystem/clock, HTTP/TCP app probes, certificate evidence, deployment correlation, bounded triage/specialists, critic veto, and resolved-only postmortems.

Semantic-watch delegate coverage now includes:

- strict configured-target parser and extra-field rejection;
- 10s..24h interval bounds;
- Strands compile success/failure runtime cleanup;
- compile-once followed by deterministic recurring execution;
- no compiler call from `watch_run`;
- built-in interval restoration on semantic removal;
- dynamic-only watch removal when no baseline exists;
- update retarget rejection;
- MCP create/update/remove/list lifecycle.

A full latest-head networked `npm install`, latest-head `npm run check`, physical MCP Inspector run, physical Strands provider invocation, and clean-directory `npx` smoke are still intentionally unclaimed because this isolated execution environment cannot resolve the required external registries/model endpoints.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. Still required:

- networked dependency install and generated lockfile;
- physical official MCP SDK / Inspector / current-host validation;
- physical Strands runtime/provider and authorized real-model validation through the bridge;
- clean package / `npx` install-and-run smoke;
- durable incident/plan/audit/restart-budget/node/certificate/deployment/semantic-watch authority;
- production identity-aware approval attribution, expiry/revocation, and durable audit;
- outbound node enrollment, mTLS, credential rotation, and production remote transport;
- Docker/Kubernetes/network/database/Minecraft adapters;
- typed recovery actions beyond systemd restart, including rollback/failover/drain/quarantine/reboot;
- physical authorized action -> execution -> resulting-state demo evidence.

## Final Invariants

- AI does not run on production nodes.
- Deterministic code owns health, dependencies, ordering, budgets, mutation, target binding, approval verification, and fresh verification.
- Process existence is not sufficient application health when probes are configured.
- Operation callers cannot choose node-local systemd units/probe targets/TLS targets/deployment marker paths.
- One unreachable node does not erase the reachable fleet.
- Node pressure, filesystem issues, clock drift, and certificate issues are observed/escalated rather than converted directly into destructive actions.
- A dependency failure does not trigger blind downstream restarts.
- A flapping service does not receive infinite automatic restarts.
- Same-target concurrent recovery is coalesced.
- Pending approval and human escalation suppress automatic retry loops.
- Semantic intent is compiled once; recurring execution is deterministic and bounded to configured targets.
- Model plans cannot choose targets.
- Model-facing MCP cannot approve elevated plans.
- Arbitrary shell execution is not a normal capability.
- Demo simulation remains explicitly labeled.
- The product remains Draft until physical runtime evidence and accountable review are complete.
