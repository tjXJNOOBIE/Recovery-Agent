# Recovery Agent Final Draft

> **Status:** Working E2E foundation / Draft promotion state  
> **Hackathon track:** Professional  
> **Shared agent runtime:** `@tjxjnoobie/custom-strands-bridge`  
> **MCP server runtime:** `@modelcontextprotocol/server` v2  
> **Owns:** Recovery Agent product policy, node/control protocol, deterministic recovery, built-in watches, incident/plan lifecycle, MCP exposure, and human approval boundary  
> **Must not define:** a second Strands framework, arbitrary remote shell execution, generic replacement infrastructure for Tavall-owned systems, or unverified production capabilities

## Product Contract

Recovery Agent keeps AI execution on a control host while small node agents expose bounded deterministic operations on machines that run services.

> **Deterministic software observes, authorizes, budgets, orders, executes, and verifies. Strands interprets, investigates, plans, critiques, and explains.**

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
- demo scenarios and simulation labeling.

Production node operations are narrow. The normal surface contains no arbitrary shell executor. Public service IDs map to configured systemd units. Remote/model callers cannot supply:

- unit names;
- shell commands/arguments;
- health URLs or ports;
- TLS certificate targets;
- deployment marker paths.

Those targets are local node configuration.

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

A configured service has one fixed systemd unit and optional fixed application checks.

Supported application checks:

- HTTP(S) GET with expected status set and bounded timeout;
- TCP connection to fixed host/port with bounded timeout.

HTTP URL credentials are rejected. Callers cannot provide probe targets at operation time.

Health composition:

1. inspect systemd lifecycle;
2. if unit is not running, skip application probes and report unhealthy lifecycle;
3. if running, evaluate every configured application probe;
4. all probes must pass for `ServiceSnapshot.healthy=true`;
5. attach individual probe evidence to the snapshot.

A process being present is therefore not equivalent to a working application.

### Deployment evidence

A service may configure `deploymentMarkerFile`.

`FileDeploymentEvidenceProbe` reads only bounded marker bytes plus file metadata and produces a SHA-256 marker. Exposed evidence contains marker hash/timestamp only; marker contents and path are not returned.

Deployment evidence is informational and **does not directly change service health**.

### Linux node evidence

`LinuxNodeResourceProbe` reads without shell execution:

- `/proc/meminfo` for memory/swap;
- OS APIs for CPU/load/uptime;
- `statfs` for root filesystem bytes/inodes;
- `/proc/self/mountinfo` for root read-only state.

It does not write a probe file.

### Certificate evidence

Configured TLS targets contain fixed ID, host, port, SNI server name, timeout, and warning/critical thresholds.

The TLS probe observes:

- reachability;
- trust/authorization state;
- certificate validity period and days remaining;
- subject / issuer;
- SHA-256 fingerprint;
- authorization and network errors.

The probe may complete a TLS handshake with certificate verification disabled **only to observe the broken peer certificate**. `authorized=false` remains explicit evidence; the connection is never promoted to trusted state.

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

Mutation response is never proof of recovery. A fresh inspection after mutation is mandatory.

## Rolling Automatic Restart Budget

`maxRestartAttempts` is a rolling automatic ceiling, not a new allowance on every watch invocation.

Default budget window: **600 seconds**.

Rules:

- every actual automatic restart consumes one slot;
- successful restarts still consume budget;
- attempts are scoped per node/service;
- expired attempts age out of the window;
- the slot is consumed before issuing mutation;
- exhausted budget executes zero restart and proceeds to investigation/escalation.

The ledger is process-local today. Durable budget authority remains a production promotion gate.

Human-approved elevated execution is outside the automatic restart ledger, but still requires approval, dependency re-check, one typed action, and fresh verification.

## Dependency Gate

Services may declare same-node or cross-node dependencies. Configuration rejects:

- unknown dependency targets;
- self-dependencies;
- duplicates;
- dependency cycles.

An unhealthy or unreachable dependency blocks automatic mutation of the dependent. `health_sweep` orders dependencies before dependents. Approved elevated execution re-checks dependencies immediately before mutation; human approval does not waive prerequisite health.

## Suppression and Concurrency Barriers

### Same-target operation barrier

Concurrent recovery requests for one node/service share the same active operation promise. Different targets remain independent.

### Pending-plan barrier

A `pending_approval` plan suppresses additional automatic mutation, incidents, and duplicate plans. Re-entry performs fresh inspection only. Verified external recovery supersedes the unexecuted plan and resolves the incident.

### Human-required barrier

Once automation hands an incident to a human without a plan, subsequent watch/manual recovery remains read-only while unhealthy. Budget is not spent and Strands is not reinvoked. External recovery resolves the incident.

### Dependency-blocked barrier

A dependency-blocked dependent remains mutation-free until prerequisite health is freshly verified.

## Partial-Fleet Behavior

`fleet_status` isolates gateway failures. One unreachable node does not erase reachable fleet state or stop bounded recovery elsewhere. Explicit `unreachableNodes` evidence is returned.

## Built-in Watches

`RecoveryWatchCoordinator` serializes product watch cycles. Current order is:

```text
node -> certificate -> deployment -> service -> readiness
```

This ordering deliberately records deployment state before service recovery mutates workload state.

### Linux Node Watch

Default limits:

```text
memory used                 > 92%
swap used                   > 80%
root filesystem bytes used  > 90%
root filesystem inodes used > 90%
1m load average / CPU       > 2.0
root filesystem read-only   must be false
node clock drift            > 30 seconds
```

Clock drift uses the midpoint of the node inspection request and records request round-trip duration separately. Node resource/filesystem/clock watch is observation/escalation only and does not reboot, drain, delete, or rewrite system time.

Node watch states include `never_run`, `healthy`, `degraded`, `unreachable`, and `unsupported`. Process-local node-health incidents open/update on degraded/unreachable evidence and resolve on fresh healthy evidence.

### Certificate Watch

Default schedule: every **6 hours**.

Default certificate thresholds:

```text
warning  <= 30 days remaining
critical <= 7 days remaining
critical on TLS authorization failure
```

Certificate warnings have their own incident lifecycle. They do not spend service restart budget or trigger blind service restart.

### Deployment Watch

The first marker is a baseline, not automatically a deployment event. A later hash change starts a **10-minute stabilization window** with a **5-second stabilization cadence**.

States include baseline/stabilizing/regressed/stable/unavailable. If the new marker is accompanied by unhealthy service evidence, a deployment regression incident opens before normal service recovery runs. Healthy evidence through the stabilization window resolves the deployment incident.

Deployment evidence does not authorize rollback or any mutation by itself.

### Service Watch

Configured services default to a 30-second watch interval. A watch delegates to the same `recoverService` path used by MCP and therefore inherits all dependencies, budgets, suppression, Strands escalation, and verification rules.

### Recovery Readiness Watch

Default schedule: every **5 minutes**.

Recovery Readiness reports whether each configured service is:

- `ready`;
- `limited`;
- `blocked`;
- `unreachable`.

It reads current health, restart policy, the same live rolling budget, dependencies, plans, and human-owned incidents. Readiness is read-only: it opens no recovery incident, consumes no budget, and performs no mutation.

A healthy workload may be `limited` if its recovery budget is exhausted or restart is not allowed.

## Strands Investigation Graph

Recovery Agent imports `@tjxjnoobie/custom-strands-bridge`, not the Strands SDK directly.

Current investigation orchestration behind the bridge contract:

```text
strict triage
  -> 1..3 unique specialist domains
      service
      application
      dependency
      deployment
      node
      network
  -> evidence synthesis
```

Triage JSON contains only severity, domains, and hypothesis. Specialist fan-out is capped at three. Malformed structured triage fails soft to one service specialist so model formatting cannot take the deterministic escalation path offline.

All specialists are read-only and explicitly forbidden from executing or claiming mutation.

## Strict Planner and Veto-Only Critic

The planner may return exactly:

```json
{"action":"restart_service","rationale":"..."}
```

or `action: "none"`.

It cannot supply target IDs, shell commands, credentials, or arbitrary arguments. Target identity comes from the deterministic incident.

When the planner proposes `restart_service`, a separate critic reviews the already-bounded proposal. Critic output is exactly:

```json
{"accepted":true,"concerns":[]}
```

The critic can **only accept or reject**. It cannot invent a new action. Rejection creates no `RecoveryPlan` and escalates to `human_required`. Critic parse/provider failure also fails closed.

## Human Approval Boundary

Approval/rejection are deliberately absent from model-facing MCP.

When `RECOVERY_APPROVAL_TOKEN` is configured, the control host creates an owner-only Unix socket with mode `0600`.

```bash
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

Wrong-token requests perform no mutation. A valid approval executes exactly one already-target-bound typed action, after a fresh dependency re-check, then verifies health again.

This socket/token mechanism is the E2E foundation, not final production approver identity. Accountable approver identity, attribution, expiry/revocation, and durable audit remain promotion gates.

## Resolved-Incident Postmortems

`incident_postmortem` is a read-only MCP operation.

Rules:

1. deterministic control state must show the incident is `resolved`;
2. unresolved incidents are rejected before a Strands runtime is created;
3. only recovery plans whose `incidentId` matches are supplied as evidence;
4. incident identity is deterministic, not model output;
5. model output is strict typed JSON containing summary, root cause, contributing factors, recovery, prevention, and confidence;
6. the prompt requires `rootCause="unknown"` when causality is not established and forbids invented people, deployments, actions, or outcomes.

Postmortem generation does not mutate incident state or infrastructure.

## Model-Facing MCP Surface

Current intention-level catalog:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `fleet_status` | No | Partial-fleet node/service/resource state. |
| `recovery_readiness` | No | Current recoverability and blockers. |
| `node_inspect` | No | Inspect one node. |
| `service_inspect` | No | Inspect one service + app/deployment evidence. |
| `service_recover` | Bounded | Deterministic policy-controlled recovery. |
| `health_sweep` | Bounded | Dependency-ordered recovery on reachable fleet. |
| `watch_list` | No | Combined watch states/incidents. |
| `watch_run` | Bounded | Force deterministic built-in watch passes. |
| `incident_list` | No | List service recovery incidents. |
| `incident_inspect` | No | Inspect one incident timeline. |
| `incident_postmortem` | No | Typed postmortem for one resolved incident. |
| `recovery_plan_list` | No | List typed plans. |
| `recovery_plan_inspect` | No | Inspect one typed plan. |

No approval tool exists in the model-facing catalog.

## Incident and Runtime State

Current service incident statuses include:

```text
open
recovering
dependency_blocked
approval_required
human_required
resolved
```

Plan statuses include:

```text
pending_approval
approved
executed
rejected
failed
superseded
```

Current incident/plan/budget/watch/node-health/certificate/deployment state is process-local and is **not durable authority**. Durable persistence, retention, migration, restart recovery, and audit semantics remain a production gate.

## Demo Truthfulness

`recovery-agent demo` remains explicitly labeled `SIMULATED DEMONSTRATION`. Fake investigation/planning and simulated host/resource evidence are never presented as physical production evidence. Elevated plans are not auto-approved.

## Validation Evidence

Earlier branch foundation validation completed:

- Node `v22.16.0`;
- TypeScript `v5.8.3`;
- 30/30 delegate/E2E tests;
- strict TypeScript check;
- production build;
- package dry-run with tests excluded.

Later focused/dependency-free and live harness validation covers:

- rolling restart-window exhaustion/expiry and flapping prevention;
- dependency graph validation, blocking, ordering, and approved-action re-check;
- partial-fleet isolation;
- memory/swap/disk/inode/load/read-only Linux evidence;
- midpoint clock-drift detection and recovery;
- node-health incident lifecycle;
- live HTTP expected-status and TCP app checks;
- systemd + app-probe health composition;
- TLS expiry/trust observation using a generated self-signed certificate;
- certificate warning/critical/unreachable lifecycle;
- deployment marker content non-disclosure and change detection;
- deployment baseline/regression/stabilization/stable lifecycle;
- bounded Strands triage/specialist routing and malformed-triage fallback;
- veto-only critic shape and zero-plan behavior on rejection;
- strict postmortem parsing, resolved-only precondition, runtime cleanup, and incident-plan scoping.

The isolated execution environment cannot currently resolve external package/model endpoints. Therefore the newest branch **does not claim** a fresh complete `npm install`, full latest-branch `npm run check`, physical MCP Inspector run, physical Strands SDK/model invocation, or clean-directory `npx` smoke test.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT` until these gates are satisfied:

- networked dependency install and generated lockfile;
- physical official MCP SDK + Inspector/current-host validation;
- physical Strands runtime/provider + authorized real-model validation through the shared bridge;
- clean-directory package / `npx` install-and-run smoke;
- durable incident/plan/audit/restart-budget/node/certificate/deployment authority;
- semantic user-created watch compilation;
- accountable production approval identity, attribution, expiry/revocation, and durable audit;
- outbound node enrollment, mTLS, credential rotation, and production remote transport;
- Docker/Kubernetes/network/database/Minecraft adapters;
- typed recovery actions beyond systemd restart, including rollback/failover/drain/quarantine/reboot;
- physical demo evidence showing authorized action -> execution -> resulting state on a disposable real service.

## Final Invariants

- AI does not run on production nodes.
- Arbitrary shell execution is not a normal node capability.
- Callers cannot supply infrastructure/probe/certificate/deployment targets at operation time.
- Deterministic code owns target binding, policy, dependencies, budgets, authorization, mutation, and verification.
- A process being active is not sufficient application health when probes exist.
- One unreachable node does not erase the reachable fleet.
- A dependency failure does not trigger blind downstream restart.
- A flapping service does not receive infinite fresh restart budget.
- Node pressure, read-only filesystem, clock drift, certificate problems, and deployment correlation are observed before destructive action is considered.
- Same-target recovery is coalesced.
- Pending approval and human intervention stop automatic retry loops.
- Strands specialist fan-out is bounded.
- Planner output is action-catalog bounded and cannot retarget.
- Critic may veto but cannot expand the action catalog.
- Model-facing MCP cannot approve elevated plans.
- Postmortems require resolved deterministic incident state and remain read-only.
- Demo simulation remains explicitly labeled.
- Production claims remain Draft until physical runtime evidence and accountable review are complete.
