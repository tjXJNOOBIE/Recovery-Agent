# Recovery Agent Final Draft

> **Status:** Working E2E foundation  
> **Hackathon track:** Professional  
> **Shared agent runtime:** `@tjxjnoobie/custom-strands-bridge`  
> **MCP server runtime:** `@modelcontextprotocol/server` v2  
> **Owns:** Recovery Agent product policy, node/control protocol, deterministic recovery, watch lifecycle, incident/plan state, MCP exposure, and human approval boundary  
> **Must not define:** a second Strands framework, Tavall Java infrastructure, arbitrary remote shell execution, or unverified production capabilities

## Product Contract

Recovery Agent keeps AI execution on a control host while small node agents expose bounded operations on machines that run real services.

> Deterministic software observes, authorizes, budgets, orders, executes, and verifies. Strands interprets, investigates, plans, and explains.

AI is not the mutation or authorization boundary.

## Current E2E Topology

```text
MCP host
  -> official MCP stdio server
      -> RecoveryControlRuntime
          -> partial-fleet inspection
          -> RecoveryOperationGate
          -> suppression barriers
          -> dependency health gate
          -> dependency-ordered health sweep
          -> HttpNodeAgentGateway
              -> NodeAgentHttpServer
                  -> SystemdNodeServiceRuntime
                  -> LinuxNodeResourceProbe
          -> RecoveryWatchCoordinator
              -> RecoveryNodeWatchService
                  -> deterministic resource evaluator
                  -> node-health incident repository
              -> RecoveryWatchService
                  -> bounded service recovery
          -> RecoveryOrchestrator
              -> RecoveryPolicyResolver
              -> RecoveryAutomaticRestartBudget
              -> InMemoryIncidentRepository
              -> StrandsRecoveryInvestigator
              -> StrandsRecoveryPlanner
              -> strict RecoveryPlan proposal parser

control-host human
  -> recovery-agent approve/reject
      -> owner-only Unix socket (0600)
          -> separate approval token
          -> RecoveryPlanApprovalHandler
          -> ApprovedRecoveryExecutor
              -> dependency re-check
              -> one typed action
              -> fresh verification
```

## Node Boundary

The node HTTP server exposes only:

```text
GET  /v1/node
GET  /v1/services/:serviceId
POST /v1/services/:serviceId/restart
```

Public service IDs map to fixed configured systemd units. The caller cannot provide a unit name, command, or arbitrary shell arguments.

`GET /v1/node` also returns deterministic node resource evidence when a resource probe is configured. Production Linux nodes use `LinuxNodeResourceProbe`, which reads:

- `/proc/meminfo` for memory and swap;
- Node OS APIs for one-minute load, CPU count, and uptime;
- `statfs` for root-filesystem capacity.

The resource probe does not execute a shell command.

Node authentication currently uses a per-node bearer secret loaded from the environment. The server defaults to loopback. Public-network transport is not claimed yet; remote production deployment still requires a private network/tunnel or trusted TLS termination until outbound enrollment and mutual authentication are implemented.

## Control Configuration

A service policy may include restart budget, watch, and dependency behavior:

```json
{
  "id": "payments-api",
  "restartAllowed": true,
  "maxRestartAttempts": 2,
  "restartBudgetWindowSeconds": 600,
  "watchEnabled": true,
  "watchIntervalSeconds": 30,
  "dependencies": [
    { "serviceId": "postgres" }
  ]
}
```

`dependencies[].nodeId` is optional and defaults to the owning node.

Control configuration validates:

- unique node IDs;
- unique service IDs per node;
- dependency targets exist;
- no self-dependencies;
- no duplicate dependencies;
- no dependency cycles;
- positive restart-budget/watch windows.

Secrets remain environment-owned.

## Partial-Fleet Inspection

`fleet_status` isolates each node inspection. One unreachable node does not fail the entire request.

The result contains:

- reachable `nodes` snapshots;
- `unreachableNodes` with node ID and error evidence;
- healthy/unhealthy service counts derived from reachable nodes.

Reachable node snapshots can also contain resource evidence from the node agent.

`health_sweep` continues bounded work on reachable unhealthy services. It does not attempt to infer service state on an unreachable node.

`node_inspect` provides direct read-only inspection of one configured node.

## Recovery Ordering and Dependency Gate

Declared dependencies are deterministic mutation prerequisites.

For an unhealthy target:

1. Recovery Agent verifies declared dependencies.
2. If any dependency is unhealthy, the target receives a `dependency_blocked` incident.
3. The target receives no restart attempt, no restart-budget consumption, and no Strands escalation while blocked.
4. Later recovery calls remain read-only while dependencies are unhealthy.
5. Once all dependencies are healthy, the dependency block is resolved and normal bounded target recovery resumes.

`health_sweep` orders configured unhealthy targets by dependency depth, allowing a dependency to recover before its dependent in the same sweep.

`ApprovedRecoveryExecutor` re-checks dependency health immediately before an approved mutation. Explicit human approval does not bypass an unhealthy dependency.

## Automatic Restart Budget

`RecoveryAutomaticRestartBudget` makes `maxRestartAttempts` a rolling automatic-recovery ceiling rather than a fresh allowance for each incident invocation.

Default window:

```text
600 seconds
```

Rules:

- every actual automatic restart consumes one slot;
- a successful restart still consumes budget;
- attempts are scoped by node/service target;
- expired attempts leave the rolling window;
- budget is consumed before the mutation is issued;
- when no slot remains, no restart executes;
- budget exhaustion is attached to the incident timeline before Strands investigation/planning.

The automatic budget ledger is process-local today. A control-host restart resets it. Durable budget authority is therefore a production promotion gate and must be implemented through an appropriate owning persistence boundary rather than casually recreating Tavall Database inside this TypeScript product.

Human-approved elevated recovery is intentionally outside the automatic restart ledger. It remains bounded by the separate human approval path and still re-checks policy/dependencies and verifies afterward.

## Suppression Barriers

Recovery Agent has multiple deterministic barriers that prevent repeating automatic work after ownership changes.

### In-flight operation barrier

`RecoveryOperationGate` coalesces concurrent recovery calls for the same node/service into one promise. Different targets remain independent.

### Pending-plan barrier

While a plan is `pending_approval`:

- automatic mutation is disabled for that target;
- watches/manual calls perform fresh inspection only;
- no duplicate incident or plan is created;
- verified external recovery marks the unexecuted plan `superseded` and resolves its incident.

### Human-required barrier

When an incident becomes `human_required` without a pending plan:

- automatic mutation is disabled;
- later watches/manual calls return the same incident while unhealthy;
- restart budget is not spent again;
- Strands is not reinvoked;
- verified external recovery resolves the existing incident without mutation.

### Dependency-blocked barrier

While declared dependencies are unhealthy:

- the dependent receives no mutation;
- the existing dependency-blocked incident is reused;
- the block clears only after prerequisite health is freshly verified.

## Deterministic Recovery Flow

```text
recover node/service
  -> join same-target in-flight operation if present
  -> pending plan?
      -> read-only inspect -> approval_required or superseded/healthy
  -> human-required incident?
      -> read-only inspect -> escalated or resolved/healthy
  -> inspect target
      -> healthy -> return
  -> dependencies healthy?
      -> no -> dependency_blocked, zero mutation
  -> policy says restart?
      -> rolling budget slot available?
          -> no -> zero mutation, investigate
          -> yes -> typed restart -> fresh inspect
              -> healthy -> resolve
              -> unhealthy -> continue only while budget allows
  -> deterministic path exhausted
      -> Strands investigation
      -> strict bounded proposal
          -> none/invalid -> human_required
          -> restart_service -> target bound from incident -> pending_approval
```

A mutation response is never accepted as proof of recovery. Fresh inspection is mandatory.

## Built-in Linux Node Watch

`RecoveryNodeWatchService` provides deterministic node-resource monitoring independent of Strands.

The production Linux resource snapshot currently contains:

```text
memory_used_percent
swap_used_percent
root_filesystem_used_percent
load_average_1m_per_cpu
uptime_seconds
```

Default thresholds are:

```text
memory used                 > 92%
swap used                   > 80%
root filesystem used        > 90%
1m load average / CPU       > 2.0
```

`RecoveryNodeResourceEvaluator` emits exact metric/value/threshold violations. Node watch states are:

```text
never_run
healthy
degraded
unreachable
unsupported
```

Behavior:

- `degraded` opens or updates one process-local node-health incident for the node;
- `unreachable` records reachability evidence and opens/updates the node-health incident;
- `unsupported` records that resource evidence is unavailable rather than fabricating metrics;
- a later `healthy` observation resolves the currently open node-health incident;
- repeating identical evidence does not append pointless duplicate timeline entries.

Node Watch is observation and escalation only. Resource pressure cannot automatically reboot, drain, destroy, or otherwise mutate a node through this pack.

`InMemoryNodeHealthIncidentRepository` is process-local runtime state, not durable audit authority.

## Watch Coordination

`RecoveryWatchCoordinator` owns the product-level combined watch lifecycle. It coordinates:

1. node-resource watches;
2. service watches.

The coordinator runs the node watch pass before the service watch pass. It serializes automatic cycles instead of allowing overlapping coordinator runs.

`watch_list` returns combined state containing:

- service watch states;
- node watch states;
- node-health incidents.

`watch_run` forces both watch surfaces immediately.

Configured service watches still delegate to `RecoveryControlRuntime.recoverService`, so they inherit:

- in-flight coalescing;
- pending-plan suppression;
- human-required suppression;
- dependency blocking;
- rolling budgets;
- Strands escalation;
- mandatory verification.

Service-watch failures and node-watch failures are recorded in process-local watch state rather than terminating future cycles.

The current service health signal is systemd lifecycle health. Typed HTTP/TCP application health probes are the next implementation slice.

## MCP Surface

Current model-facing tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `fleet_status` | No | Inspect reachable fleet, resource evidence, and unreachable-node evidence. |
| `node_inspect` | No | Inspect one configured node. |
| `service_inspect` | No | Inspect one configured service. |
| `service_recover` | Bounded | Run deterministic policy-controlled recovery. |
| `health_sweep` | Bounded | Recover reachable unhealthy services in dependency order. |
| `watch_list` | No | Inspect combined node/service watch state and node-health incidents. |
| `watch_run` | Bounded | Force combined node + service watches now. |
| `incident_list` | No | List process-local service recovery incidents. |
| `incident_inspect` | No | Inspect one service recovery incident timeline. |
| `recovery_plan_list` | No | List typed recovery plans. |
| `recovery_plan_inspect` | No | Inspect one plan and approval state. |

Approval/rejection are intentionally absent from MCP.

## Strands Boundary

Recovery Agent has no direct `@strands-agents/sdk` dependency. It consumes `IStrandsAgentRuntimeBootstrap` from `@tjxjnoobie/custom-strands-bridge`.

Current focused roles:

1. `StrandsRecoveryInvestigator` returns an evidence-based diagnosis after deterministic exhaustion.
2. `StrandsRecoveryPlanner` may return one strict proposal.

The planner output must be exact JSON with only:

```json
{
  "action": "restart_service",
  "rationale": "..."
}
```

or `action: "none"`.

The parser rejects extra fields, target identifiers, commands, credentials, markdown fencing, unknown actions, and invalid rationale. Node/service identity comes from deterministic incident state.

Neither Strands role can mutate, retarget, or approve.

The larger triage/specialist/critic/postmortem graph remains a future slice and must not be presented as implemented.

## Human Approval Boundary

When `RECOVERY_APPROVAL_TOKEN` is configured, the control process creates an owner-only Unix approval socket. Its path defaults per-user under the OS temporary directory and may be overridden with `RECOVERY_APPROVAL_SOCKET`.

Socket rules:

- mode `0600`;
- stale-path cleanup refuses regular files;
- stale sockets owned by another user are refused;
- request bodies are bounded;
- Bearer approval token is verified locally;
- the model-facing MCP catalog cannot call the approval path.

Human CLI:

```bash
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

A valid approval executes one already-bound typed action, re-checks declared dependencies, and performs fresh health verification.

## Incident and Plan State

Current service incident, recovery plan, node-health incident, watch, and automatic-budget state are explicitly process-local. They are not durable authority.

Current service incident statuses include:

```text
open
recovering
dependency_blocked
approval_required
human_required
resolved
```

Current plan statuses include:

```text
pending_approval
approved
executed
rejected
failed
superseded
```

Node-health incident statuses are `open` and `resolved`.

Durable incident/plan/audit/budget state, retention, migration, and restart recovery remain promotion gates.

## Demo Truthfulness

`recovery-agent demo` uses fake investigation/planning because external model-provider access is not available in the isolated build environment. It uses the real HTTP/control/recovery/combined-watch/plan code path otherwise and remains visibly labeled:

```text
SIMULATED DEMONSTRATION
```

Demo resource evidence is explicitly simulated. It does not auto-approve elevated plans.

## Validation Evidence

Previously validated branch foundation passed 30/30 delegate/E2E tests, strict TypeScript, production build, and package dry-run before the latest safety slices.

Additional focused dependency-free harnesses pass for:

- rolling restart-window consumption, exhaustion, and expiry;
- flapping-service prevention across recovery invocations;
- dependency topology cycle rejection;
- dependency-blocked zero-mutation behavior;
- dependency-first sweep ordering;
- approved-action dependency re-check;
- partial-fleet inspection when one node throws `connection refused`;
- continued recovery on reachable nodes while another node is offline;
- strict Linux resource parsing/evaluation;
- live Linux memory/disk/load evidence read without shell execution;
- node watch `degraded -> incident open -> healthy -> incident resolved` behavior.

Repository delegate coverage was added for human-required suppression, rolling budgets, dependency recovery, dependency-safe approval, fleet isolation, node resource evaluation, node-health incidents, unreachable/unsupported node watch behavior, HTTP resource propagation, and live Linux resource probing.

A full post-slice `npm run check` is not claimed because this execution environment cannot resolve external npm dependencies.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. Not yet claimed:

- real networked `npm install` and generated lockfile;
- physical `@modelcontextprotocol/server@2.0.0` validation with MCP Inspector/current host;
- physical Strands SDK/runtime validation through the shared bridge;
- authorized real-model investigation/planning;
- clean-directory `npx` package smoke test;
- durable incidents/plans/audit/restart-budget/node-health authority;
- typed HTTP/TCP service-health probes;
- deployment, certificate, filesystem/inode/clock-drift, and recovery-readiness watch coverage;
- semantic user-watch compilation;
- full Strands triage/specialist/critic/postmortem graph;
- production identity-aware approvals with approver attribution, expiry/revocation, durable audit, and richer host-native confirmation;
- outbound node enrollment, mTLS, credential rotation, and public production transport;
- Docker/Kubernetes/network/database/Minecraft adapters;
- typed recovery actions beyond systemd restart, including rollback/failover/drain/quarantine/reboot;
- physical demo evidence showing action -> execution -> resulting state on an authorized disposable service.

## Final Invariants

- AI does not run on production nodes.
- Deterministic code owns health decisions, dependencies, ordering, authorization, automatic budgets, mutation, approval verification, and fresh verification.
- One unreachable node does not erase the reachable fleet.
- Node resource pressure is observed and escalated, not converted directly into destructive action.
- A dependency failure does not trigger blind downstream restarts.
- A flapping service does not receive an infinite fresh restart budget.
- Same-target concurrent recovery is coalesced.
- Pending approval and human escalation stop automatic retries.
- Model plans cannot choose targets.
- Model-facing MCP cannot approve elevated plans.
- Arbitrary shell execution is not a normal capability.
- Demo simulation remains explicitly labeled.
- The product remains Draft until physical runtime evidence and accountable review are complete.
