# Recovery Agent Final Draft

> **Status:** Working E2E foundation  
> **Hackathon track:** Professional  
> **Shared agent runtime:** `@tjxjnoobie/custom-strands-bridge`  
> **MCP server runtime:** `@modelcontextprotocol/server` v2  
> **Owns:** Recovery Agent product policy, node/control protocol, incident/recovery flow, MCP tool exposure, approval boundary, and demo behavior  
> **Must not define:** a second Strands framework, Tavall Java DI/cache/registry/database/concurrency/event/scheduler systems, arbitrary remote shell execution, or unverified production capabilities

## About

Recovery Agent keeps AI execution on a control host while small node agents expose bounded operations on machines that run real services. Health evaluation, authorization, mutation, recovery budgets, target selection, approval verification, and post-action verification remain deterministic. Strands is invoked only after deterministic recovery cannot safely resolve an incident.

The product rule is:

> Deterministic software observes, authorizes, executes, and verifies. Strands interprets, investigates, plans, and explains.

## Ownership Rules

Recovery Agent owns:

- node/service health snapshots;
- the control-host node composition snapshot;
- service recovery policies and restart budgets;
- incident and typed recovery-plan lifecycle;
- typed node action routing;
- deterministic verification after mutation;
- built-in service-watch lifecycle;
- MCP tool exposure;
- the control-host-only approval socket;
- demo scenarios and simulation labeling;
- product prompts and Strands investigation/planning context.

Connected runtimes own:

- systemd service lifecycle and process state;
- model/provider credentials;
- Strands lifecycle and model/tool loop through `custom-strands-bridge`;
- any future Tavall Java infrastructure reached through typed MCP/tool boundaries.

Recovery Agent must not expose arbitrary shell execution as a normal recovery capability.

## Current E2E Runtime Flow

```text
MCP host
  -> official MCP stdio server
      -> RecoveryMcpToolRouter
          -> RecoveryControlRuntime
              -> HttpNodeAgentGateway
                  -> NodeAgentHttpServer
                      -> SystemdNodeServiceRuntime
              -> RecoveryWatchService
                  -> configured interval -> bounded recoverService
              -> RecoveryOrchestrator
                  -> RecoveryPolicyResolver
                  -> InMemoryIncidentRepository
                  -> StrandsRecoveryInvestigator
                  -> StrandsRecoveryPlanner -> strict proposal parser
                  -> pending RecoveryPlan

control-host human
  -> recovery-agent approve/reject CLI
      -> owner-only Unix approval socket (0600)
          -> RecoveryPlanApprovalHandler
              -> out-of-band token verification
              -> one approved typed action
              -> fresh verification
```

### Recovery flow

```text
inspect service
  -> healthy: return without mutation
  -> unhealthy: open incident
      -> unknown state: refuse mutation and escalate
      -> restart allowed: execute typed restart
          -> inspect again
          -> healthy: resolve incident
          -> unhealthy and budget remains: retry
          -> budget exhausted: invoke Strands investigation
              -> invoke strict bounded planner
              -> none/invalid proposal: require human intervention
              -> restart_service proposal: bind target from incident
                  -> store pending elevated plan
                  -> MCP may inspect, but cannot approve
                  -> owner uses control-host approval CLI/socket
                      -> verify separate approval token
                      -> execute exactly one typed restart
                      -> inspect again
                      -> resolve or return to human_required
```

A mutation result never proves recovery. The control host always performs a fresh service inspection after the mutation.

## Node Boundary

The node HTTP server currently exposes only:

```text
GET  /v1/node
GET  /v1/services/:serviceId
POST /v1/services/:serviceId/restart
```

A public `serviceId` is mapped by node configuration to one fixed systemd unit. Remote callers cannot choose the unit string and cannot submit a shell command.

Node authentication is currently a per-node bearer secret loaded from an environment variable. The server defaults to loopback. This is adequate for local/demo validation but is **not the final public-network transport**. Remote deployment requires a private network/tunnel or trusted TLS termination until outbound enrollment, credential rotation, and mutual-authenticated transport are implemented.

## Control Configuration

Control config owns the node/service policy snapshot:

```json
{
  "nodes": [
    {
      "id": "production-east-01",
      "baseUrl": "http://127.0.0.1:7281",
      "tokenEnvironmentVariable": "RECOVERY_NODE_TOKEN_EAST_01",
      "services": [
        {
          "id": "payments-api",
          "restartAllowed": true,
          "maxRestartAttempts": 2,
          "watchEnabled": true,
          "watchIntervalSeconds": 30
        }
      ]
    }
  ]
}
```

Secrets do not live in the config document.

Control-host approval environment:

- `RECOVERY_APPROVAL_TOKEN`: optional separate secret. Without it, elevated-plan approval is disabled.
- `RECOVERY_APPROVAL_SOCKET`: optional Unix-socket path override. Otherwise a per-user path beneath the OS temp directory is used.

## MCP Surface

Recovery Agent consumes the official MCP TypeScript server SDK v2 rather than implementing its own MCP transport.

Current model-facing tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `fleet_status` | No | Inspect configured nodes/services. |
| `service_inspect` | No | Inspect one configured service. |
| `service_recover` | Bounded | Run policy-controlled recovery for one service. |
| `health_sweep` | Bounded | Inspect configured services and recover unhealthy ones within policy. |
| `watch_list` | No | List built-in watch configuration and latest runtime state. |
| `watch_run` | Bounded | Force configured service watches to execute now. |
| `incident_list` | No | List incidents in the current control runtime. |
| `incident_inspect` | No | Inspect one incident timeline. |
| `recovery_plan_list` | No | List typed plans proposed after automatic recovery is exhausted. |
| `recovery_plan_inspect` | No | Inspect one plan and its state. |

**Approval and rejection are not MCP tools.** The model-facing host can inspect a proposed plan but cannot execute the approval path.

## Typed Recovery Plans

After deterministic recovery is exhausted, Strands still does not gain an executor. `StrandsRecoveryPlanner` receives bounded incident evidence and must return exactly one strict JSON object:

```json
{
  "action": "restart_service",
  "rationale": "One additional approved restart may distinguish a transient failure."
}
```

The only accepted actions are `restart_service` and `none`. `RecoveryPlanProposalParser` rejects:

- markdown fencing;
- additional fields;
- alternate node/service targets;
- shell commands or arguments;
- credentials;
- unknown action names;
- blank or oversized rationale text.

Node and service identity are copied from the incident by deterministic code; the model never chooses them. A valid restart proposal becomes an `elevated` `RecoveryPlan` with status `pending_approval`.

## Human Approval Boundary

The MCP control process creates `RecoveryApprovalSocketServer` only when `RECOVERY_APPROVAL_TOKEN` is configured. The Unix socket is created with mode `0600`. A stale path is removed only when it is a socket owned by the current control-host user; Recovery Agent refuses to remove a regular file or another user's socket.

The human approval path is:

```bash
export RECOVERY_APPROVAL_TOKEN='separate-long-secret'
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

`RecoveryApprovalSocketClient` sends the token only to the local Unix socket. The model-facing MCP catalog does not provide an approval operation and does not return the token.

A valid approval:

1. verifies the separate token;
2. transitions the pending plan to approved;
3. executes exactly one typed action against the already-bound node/service;
4. performs a fresh service inspection;
5. marks the plan `executed` only when health is restored;
6. otherwise marks the plan failed and returns the incident to `human_required`.

This local socket + token mechanism is the E2E foundation, not the final production identity system. Production approver identity, attribution, expiry/revocation, durable audit, and richer host-native confirmation remain future work.

## Built-in Service Watches

Each configured service receives a built-in watch by default. `watchEnabled` may disable it and `watchIntervalSeconds` controls its interval, defaulting to 30 seconds.

`RecoveryWatchService` is a product lifecycle service, not a replacement generic scheduler. Due watches delegate to `RecoveryControlRuntime.recoverService`, preserving one recovery path for user-triggered and automatic execution.

Watch invariants:

- only one timer-driven watch cycle executes at a time;
- an explicit `watch_run` waits for any active cycle before forcing all configured watches;
- a watch that has not reached its interval is skipped;
- watch errors are recorded instead of terminating future cycles;
- watch state is process-local and is not incident/audit authority.

Current built-in coverage is service lifecycle health. Node resource pressure, deployment correlation, dependency health, certificate expiry, and recovery-readiness packs remain unimplemented.

## Strands Boundary

Recovery Agent has no direct `@strands-agents/sdk` dependency. It uses `IStrandsAgentRuntimeBootstrap` from `@tjxjnoobie/custom-strands-bridge`.

The current E2E Strands layer has two focused roles:

1. `StrandsRecoveryInvestigator` returns an evidence-based diagnosis.
2. `StrandsRecoveryPlanner` may return one strict bounded proposal after investigation.
3. Both close their bridge runtime in `finally`.
4. Neither can execute a node mutation, select a target outside the incident, or approve a plan.

`RECOVERY_AGENT_INVESTIGATION_MCP_URL` may add an investigation-only MCP server to the Strands runtime. No external investigation MCP is enabled by default.

The larger planned Strands graph (triage router, specialist investigators, critic, postmortem, richer evidence collection) is not yet implemented and must not be presented as working behavior.

## Incident and Plan State

`InMemoryIncidentRepository` and `InMemoryRecoveryPlanRepository` currently own process-local incident and plan state. They are explicit runtime-only state and are not durable authority. Restarting the control process loses history and pending plans.

Before production promotion, incident/plan/audit history requires a durable owning boundary with explicit retention, migration, cleanup, and recovery behavior. Recovery Agent must consume the appropriate owning persistence runtime instead of casually reinventing Tavall Database in TypeScript.

## Demo

`recovery-agent demo` starts an ephemeral loopback node HTTP server and drives the same control gateway, policy resolver, orchestrator, watch service, incident repository, planner path, and MCP router used by the real runtime.

The demo uses fake investigation/planning because model-provider access is external. It does not auto-approve the pending elevated plan. Output is labeled `SIMULATED DEMONSTRATION` and must remain distinguishable from physical product/model evidence.

## Implemented Validation

The current local E2E harness covers:

- stopped service -> typed restart -> fresh verification -> incident resolved;
- repeatedly failing service -> bounded restart budget -> investigation -> strict typed proposal -> pending approval;
- real local HTTP boundary between control gateway and demo node runtime;
- bearer authentication on the node boundary;
- recurring service watch due/skip behavior and forced execution;
- planner target/command injection rejection and non-JSON rejection;
- Strands runtime cleanup on success and malformed output;
- model-facing MCP has no approval/rejection execution operation;
- owner-only Unix approval socket mode `0600`;
- wrong approval token -> no service mutation;
- valid local approval -> one typed restart -> fresh verification -> executed/failed plan state;
- systemd public service ID -> fixed unit mapping with no shell-input surface.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. The following are not yet claimed:

- real `npm install` and generated dependency lockfile in a networked development environment;
- physical `@modelcontextprotocol/server@2.0.0` validation with MCP Inspector/current host;
- physical `@strands-agents/sdk@1.16.0` validation inherited from the bridge;
- authorized real model invocation through the bridge;
- clean-directory package/npx install-and-run smoke test;
- durable incident/plan/audit persistence;
- built-in node/deployment/dependency/certificate/recovery-readiness watch packs and semantic user-watch compilation;
- full Strands triage/specialist/critic/postmortem graph;
- production identity-aware approval with attribution, expiry/revocation, durable audit, and richer host-native confirmation;
- outbound node enrollment, credential rotation, mutual authentication, and production remote transport;
- Docker/Kubernetes/network/database/Minecraft adapters;
- recovery budgets/actions beyond bounded systemd restart, including rollback/failover/drain/quarantine/reboot policy;
- production demo evidence showing real action -> execution -> result/state change on an authorized disposable service.

## Final Rules Summary

- AI does not run on production nodes.
- Deterministic software owns checks, authorization, mutation, budgets, target binding, approval verification, and post-action verification.
- Strands is an investigation/planning runtime, never the authorization boundary.
- Model plans cannot choose targets.
- Model-facing MCP cannot approve or reject elevated plans.
- Node operations are typed and configured; arbitrary shell execution is not a normal capability.
- Every mutation is followed by fresh deterministic verification.
- Built-in service watches reuse the same bounded recovery path as user-triggered recovery.
- Elevated plans remain inert until approval arrives through the owner-only control-host socket and the separate token is verified.
- Unknown or exhausted recovery paths escalate instead of looping indefinitely.
- Demo behavior remains clearly labeled when simulated.
- The system remains Draft until physical external/runtime evidence and accountable review are complete.
