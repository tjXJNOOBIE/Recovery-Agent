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
          -> RecoveryWatchService
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

## MCP Surface

Current model-facing tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `fleet_status` | No | Inspect reachable fleet and unreachable-node evidence. |
| `node_inspect` | No | Inspect one configured node. |
| `service_inspect` | No | Inspect one configured service. |
| `service_recover` | Bounded | Run deterministic policy-controlled recovery. |
| `health_sweep` | Bounded | Recover reachable unhealthy services in dependency order. |
| `watch_list` | No | Inspect built-in service-watch state. |
| `watch_run` | Bounded | Force configured service watches now. |
| `incident_list` | No | List process-local incidents. |
| `incident_inspect` | No | Inspect one incident timeline. |
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

## Watches

Configured service watches default to enabled at 30 seconds. `RecoveryWatchService` is product lifecycle behavior, not a second generic scheduler framework.

A due watch delegates to `RecoveryControlRuntime.recoverService`, so it automatically inherits:

- in-flight coalescing;
- pending-plan suppression;
- human-required suppression;
- dependency blocking;
- rolling budgets;
- Strands escalation;
- mandatory verification.

Watch failures are recorded in process-local watch state rather than terminating future cycles.

## Incident and Plan State

Current incident and plan repositories are explicitly process-local. They are not durable authority.

Current incident statuses include:

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

Durable incident/plan/audit state, retention, migration, and restart recovery remain promotion gates.

## Demo Truthfulness

`recovery-agent demo` uses fake investigation/planning because external model-provider access is not available in the isolated build environment. It uses the real HTTP/control/recovery/watch/plan code path otherwise and remains visibly labeled:

```text
SIMULATED DEMONSTRATION
```

It does not auto-approve elevated plans.

## Validation Evidence

Previously validated branch foundation passed 30/30 delegate/E2E tests, strict TypeScript, production build, and package dry-run before the latest safety slices.

Additional focused dependency-free harnesses now pass for:

- rolling restart-window consumption, exhaustion, and expiry;
- flapping-service prevention across recovery invocations;
- dependency topology cycle rejection;
- dependency-blocked zero-mutation behavior;
- dependency-first sweep ordering;
- approved-action dependency re-check;
- partial-fleet inspection when one node throws `connection refused`;
- continued recovery on reachable nodes while another node is offline.

Additional repository tests were added for human-required suppression, rolling budgets, dependency recovery, dependency-safe approval, and fleet isolation. A full post-slice `npm run check` is not claimed because this execution environment cannot resolve external npm dependencies.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. Not yet claimed:

- real networked `npm install` and generated lockfile;
- physical `@modelcontextprotocol/server@2.0.0` validation with MCP Inspector/current host;
- physical Strands SDK/runtime validation through the shared bridge;
- authorized real-model investigation/planning;
- clean-directory `npx` package smoke test;
- durable incidents/plans/audit/restart-budget authority;
- node resource-pressure, deployment, certificate, and recovery-readiness watch packs;
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
- A dependency failure does not trigger blind downstream restarts.
- A flapping service does not receive an infinite fresh restart budget.
- Same-target concurrent recovery is coalesced.
- Pending approval and human escalation stop automatic retries.
- Model plans cannot choose targets.
- Model-facing MCP cannot approve elevated plans.
- Arbitrary shell execution is not a normal capability.
- Demo simulation remains explicitly labeled.
- The product remains Draft until physical runtime evidence and accountable review are complete.
