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
                      -> fixed node-configured HTTP/TCP health probes
                  -> LinuxNodeResourceProbe
          -> RecoveryWatchCoordinator
              -> RecoveryNodeWatchService
                  -> deterministic resource/filesystem evaluator
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

Public service IDs map to fixed configured systemd units. The caller cannot provide a unit name, command, arbitrary shell arguments, health URL, or health port.

A node service definition may include fixed health checks:

```json
{
  "id": "payments-api",
  "unit": "payments-api.service",
  "healthChecks": [
    {
      "type": "http",
      "url": "http://127.0.0.1:8080/health",
      "timeoutMs": 2000,
      "expectedStatusCodes": [200]
    },
    {
      "type": "tcp",
      "host": "127.0.0.1",
      "port": 8080,
      "timeoutMs": 2000
    }
  ]
}
```

Application probe targets are local node configuration, not remote/model inputs. HTTP config permits only HTTP(S), rejects embedded URL credentials, validates expected status codes, and bounds timeouts. TCP config validates host/port and bounded timeout.

`SystemdNodeServiceRuntime` composes lifecycle and application health. When systemd is not running, application probes are skipped. When systemd is running, every configured probe must pass for `ServiceSnapshot.healthy` to be true. Probe results are attached to the service snapshot as evidence. Probe implementation failure fails closed into an unhealthy result rather than disappearing behind an exception.

`GET /v1/node` also returns deterministic node resource evidence when a resource probe is configured. Production Linux nodes use `LinuxNodeResourceProbe`, which reads:

- `/proc/meminfo` for memory and swap;
- Node OS APIs for one-minute load, CPU count, and uptime;
- `statfs` for root-filesystem byte and inode capacity;
- `/proc/self/mountinfo` for root-filesystem read-only state.

The resource probe does not execute a shell command and does not write a probe file.

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

Control configuration validates unique nodes/services, dependency targets, no self/duplicate/cyclic dependencies, and positive restart-budget/watch windows. Secrets remain environment-owned.

## Partial-Fleet Inspection

`fleet_status` isolates each node inspection. One unreachable node does not fail the entire request.

The result contains reachable node snapshots, explicit `unreachableNodes` evidence, and service-health counts derived only from reachable nodes. Reachable service snapshots include application-probe evidence when configured, and node snapshots can include resource/filesystem evidence.

`health_sweep` continues bounded work on reachable unhealthy services. It does not infer state on an unreachable node. `node_inspect` provides direct read-only inspection of one configured node.

## Recovery Ordering and Dependency Gate

Declared dependencies are deterministic mutation prerequisites.

For an unhealthy target:

1. Recovery Agent verifies declared dependencies.
2. If any dependency is unhealthy, the target receives a `dependency_blocked` incident.
3. The target receives no restart attempt, no restart-budget consumption, and no Strands escalation while blocked.
4. Later recovery calls remain read-only while dependencies are unhealthy.
5. Once all dependencies are healthy, the dependency block is resolved and normal bounded target recovery resumes.

`health_sweep` orders configured unhealthy targets by dependency depth. `ApprovedRecoveryExecutor` re-checks dependency health immediately before an approved mutation. Human approval does not bypass an unhealthy dependency.

## Automatic Restart Budget

`RecoveryAutomaticRestartBudget` makes `maxRestartAttempts` a rolling automatic-recovery ceiling rather than a fresh allowance for each incident invocation. The default window is 600 seconds.

Every actual automatic restart consumes one slot, including successful restarts. Attempts are scoped by node/service, expired attempts leave the window, budget is consumed before mutation, and an exhausted budget causes zero restart before investigation/planning.

The automatic budget ledger is process-local today. Durable budget authority remains a production promotion gate. Human-approved elevated recovery is outside the automatic ledger but still requires policy/dependency checks and fresh verification.

## Suppression Barriers

Recovery Agent has deterministic barriers that prevent repeated automatic work after ownership changes.

- `RecoveryOperationGate` coalesces same-target concurrent recovery.
- `pending_approval` disables automatic mutation and duplicate plans until decision or verified external recovery.
- `human_required` disables repeated automatic mutation/Strands invocation until verified external recovery.
- `dependency_blocked` disables dependent mutation until prerequisite health is freshly verified.

## Deterministic Recovery Flow

```text
recover node/service
  -> join same-target in-flight operation if present
  -> pending plan?
      -> read-only inspect -> approval_required or superseded/healthy
  -> human-required incident?
      -> read-only inspect -> escalated or resolved/healthy
  -> inspect target
      -> systemd + configured app probes determine health
      -> healthy -> return
  -> dependencies healthy?
      -> no -> dependency_blocked, zero mutation
  -> policy says restart?
      -> rolling budget slot available?
          -> no -> zero mutation, investigate
          -> yes -> typed restart -> fresh systemd + app-probe inspection
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

`RecoveryNodeWatchService` provides deterministic node monitoring independent of Strands.

Production Linux evidence currently contains:

```text
memory_used_percent
swap_used_percent
root_filesystem_used_percent
root_filesystem_inode_used_percent (when supported)
root_filesystem_read_only (when determinable)
load_average_1m_per_cpu
uptime_seconds
```

Default limits are:

```text
memory used                 > 92%
swap used                   > 80%
root filesystem bytes used  > 90%
root filesystem inodes used > 90%
1m load average / CPU       > 2.0
root filesystem read-only   must be false
```

Numeric pressure and read-only state are distinct violation types. A read-only filesystem is not represented as a fake numeric threshold.

Node watch states are `never_run`, `healthy`, `degraded`, `unreachable`, and `unsupported`.

- degraded/unreachable evidence opens or updates one process-local node-health incident;
- unsupported telemetry is recorded without fabricating evidence;
- a later healthy observation resolves the open node-health incident;
- repeating identical evidence does not append duplicate timeline noise.

Node Watch is observation/escalation only. Resource pressure, inode pressure, or a read-only root filesystem cannot automatically reboot, drain, destroy, or otherwise mutate the node through this pack.

## Watch Coordination

`RecoveryWatchCoordinator` owns the combined watch lifecycle. It runs the node watch pass before the service watch pass and serializes automatic coordinator cycles.

`watch_list` returns service watch states, node watch states, and node-health incidents. `watch_run` forces both surfaces.

Service watches delegate to the same `RecoveryControlRuntime.recoverService` path and therefore inherit app-level health, in-flight coalescing, suppression, dependency blocking, rolling budgets, Strands escalation, and mandatory verification.

Watch failures are stored in process-local watch state rather than terminating future cycles.

## MCP Surface

Current model-facing tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `fleet_status` | No | Inspect reachable fleet, app/resource evidence, and unreachable-node evidence. |
| `node_inspect` | No | Inspect one configured node. |
| `service_inspect` | No | Inspect one configured service and probe evidence. |
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

Current focused roles are evidence-based investigation after deterministic exhaustion and one strict bounded proposal. The planner output is exact JSON with only `action` (`restart_service` or `none`) and `rationale`.

The parser rejects extra fields, target identifiers, commands, credentials, markdown fencing, unknown actions, and invalid rationale. Target identity comes from deterministic incident state. Strands cannot mutate, retarget, or approve.

The larger triage/specialist/critic/postmortem graph remains future work and must not be presented as implemented.

## Human Approval Boundary

When `RECOVERY_APPROVAL_TOKEN` is configured, the control process creates an owner-only Unix approval socket. Its path defaults per-user under the OS temporary directory and may be overridden with `RECOVERY_APPROVAL_SOCKET`.

The socket is mode `0600`; stale-path cleanup refuses regular files/other owners; request bodies are bounded; the Bearer token is verified locally; and the model-facing MCP catalog cannot invoke approval.

```bash
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

A valid approval executes one already-bound typed action, re-checks declared dependencies, and performs fresh health verification including configured application probes.

## Incident and Plan State

Current service incidents, recovery plans, node-health incidents, watch state, and automatic-budget state are process-local, not durable authority.

Service incident statuses include `open`, `recovering`, `dependency_blocked`, `approval_required`, `human_required`, and `resolved`. Plan statuses include `pending_approval`, `approved`, `executed`, `rejected`, `failed`, and `superseded`. Node-health incidents are `open` or `resolved`.

Durable incident/plan/audit/budget state, retention, migration, and restart recovery remain promotion gates.

## Demo Truthfulness

`recovery-agent demo` uses fake investigation/planning because external model-provider access is unavailable in the isolated build environment. It uses the real HTTP/control/recovery/combined-watch/plan code path otherwise and remains visibly labeled `SIMULATED DEMONSTRATION`. Demo resource evidence is explicitly simulated and elevated plans are not auto-approved.

## Validation Evidence

The earlier branch foundation passed 30/30 delegate/E2E tests, strict TypeScript, production build, and package dry-run before later slices.

Additional focused dependency-free validation passes for:

- rolling restart-window consumption/exhaustion/expiry and flapping prevention;
- dependency topology, zero-mutation blocking, ordering, and approval re-check;
- partial-fleet isolation and reachable-node recovery;
- Linux memory/disk/load resource evidence and node-health incident lifecycle;
- live node-side HTTP expected-status success, unexpected-status failure, and TCP connection success;
- node health config parsing and rejection of unsafe/invalid health targets;
- active systemd service becoming unhealthy when application probes fail;
- live Linux inode totals/usage and root mount read/write evidence;
- distinct inode-pressure and read-only-filesystem violations.

Repository delegate coverage includes human suppression, rolling budgets, dependency safety, fleet isolation, resource evaluation, node-health incidents, HTTP resource propagation, Linux probing, application health probing, health config validation, and systemd/probe composition.

A full post-slice `npm run check` is not claimed because this execution environment cannot resolve external npm dependencies.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. Not yet claimed:

- real networked `npm install` and generated lockfile;
- physical `@modelcontextprotocol/server@2.0.0` validation with MCP Inspector/current host;
- physical Strands SDK/runtime validation through the shared bridge;
- authorized real-model investigation/planning;
- clean-directory `npx` package smoke test;
- durable incidents/plans/audit/restart-budget/node-health authority;
- deployment, certificate, clock-drift, and recovery-readiness watch coverage;
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
- Systemd process existence is not sufficient application-health evidence when probes are configured.
- Probe targets come from node configuration, never model-supplied operation arguments.
- One unreachable node does not erase the reachable fleet.
- Node resource/filesystem pressure is observed and escalated, not converted directly into destructive action.
- A dependency failure does not trigger blind downstream restarts.
- A flapping service does not receive an infinite fresh restart budget.
- Same-target concurrent recovery is coalesced.
- Pending approval and human escalation stop automatic retries.
- Model plans cannot choose targets.
- Model-facing MCP cannot approve elevated plans.
- Arbitrary shell execution is not a normal capability.
- Demo simulation remains explicitly labeled.
- The product remains Draft until physical runtime evidence and accountable review are complete.
