# Recovery Agent Final Draft

> **Status:** Working E2E foundation  
> **Hackathon track:** Professional  
> **Shared agent runtime:** `@tjxjnoobie/custom-strands-bridge`  
> **MCP server runtime:** `@modelcontextprotocol/server` v2  
> **Owns:** Recovery Agent product policy, node/control protocol, incident/recovery flow, MCP tool exposure, demo behavior  
> **Must not define:** a second Strands framework, Tavall Java DI/cache/registry/database/concurrency/event/scheduler systems, arbitrary remote shell execution, or unverified production capabilities

## About

Recovery Agent keeps AI execution on a control host while small node agents expose bounded operations on machines that run real services. Health evaluation, authorization, mutation, recovery budgets, and post-action verification remain deterministic. Strands is invoked only when deterministic recovery cannot safely resolve an incident or when a future semantic watch explicitly requires investigation.

The product rule is:

> Deterministic software observes, authorizes, executes, and verifies. Strands interprets, investigates, plans, and explains.

## Ownership Rules

Recovery Agent owns:

- node/service health snapshots;
- the control-host node composition snapshot;
- service recovery policies and restart budgets;
- incident creation and timeline updates;
- typed node action routing;
- deterministic verification after mutation;
- MCP tool exposure;
- demo scenarios and simulation labeling;
- product prompts and Strands investigation context.

Connected runtimes own:

- systemd service lifecycle and process state;
- model/provider credentials;
- Strands lifecycle and model/tool loop through `custom-strands-bridge`;
- any future Tavall Java infrastructure reached through typed MCP/tool boundaries.

Recovery Agent must not expose arbitrary shell command execution as a normal recovery capability.

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
                  -> StrandsRecoveryInvestigator (only after bounded recovery fails)
                  -> StrandsRecoveryPlanner -> strict proposal parser
                  -> pending RecoveryPlan
              -> RecoveryPlanApprovalHandler
                  -> out-of-band token verification
                  -> one approved typed action -> fresh verification
```

### Recovery flow

```text
inspect service
  -> healthy: return without mutation
  -> unhealthy: open incident
      -> unknown state: refuse mutation and escalate
      -> restart allowed: execute one typed restart
          -> inspect again
          -> healthy: resolve incident
          -> unhealthy and budget remains: retry
          -> budget exhausted: invoke read-only Strands investigation
              -> invoke strict bounded Strands planner
              -> none/invalid proposal: require human intervention
              -> restart_service proposal: bind target from incident
                  -> store pending elevated plan
                  -> require out-of-band approval token
                  -> approved: execute exactly one typed restart
                      -> inspect again
                      -> resolve or return to human_required
```

A restart result by itself never proves recovery. The control host always performs a fresh service inspection after the mutation.

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

Secrets do not live in the config document. `RECOVERY_APPROVAL_TOKEN` is an optional control-host environment secret. Without it, recovery-plan approval is disabled even though read-only plan inspection remains available.

## MCP Surface

Recovery Agent consumes the official MCP TypeScript server SDK v2 rather than implementing its own transport. The SDK serves both current `2026-07-28` and legacy MCP eras from stdio.

Current tools:

| Tool | Mutation | Purpose |
| --- | --- | --- |
| `fleet_status` | No | Inspect configured nodes/services. |
| `service_inspect` | No | Inspect one configured service. |
| `service_recover` | Bounded | Run policy-controlled recovery for one service. |
| `health_sweep` | Bounded | Inspect all configured services and recover unhealthy ones within policy. |
| `watch_list` | No | List built-in service watch configuration and latest runtime state. |
| `watch_run` | Bounded | Force all configured service watches to execute now. |
| `incident_list` | No | List incidents in the current control runtime. |
| `incident_inspect` | No | Inspect one incident timeline. |
| `recovery_plan_list` | No | List typed plans proposed after automatic recovery is exhausted. |
| `recovery_plan_inspect` | No | Inspect one plan and its state. |
| `recovery_plan_approve` | Elevated | Verify the out-of-band approval token, execute one pending typed plan, and verify health. |
| `recovery_plan_reject` | Approval-gated | Reject a pending plan and record the decision. |

This catalog represents user intentions rather than mirroring every operating-system verb.


## Typed Recovery Plans and Approval Gate

After deterministic recovery is exhausted, Strands still does not gain an executor. `StrandsRecoveryPlanner` receives bounded incident evidence and is instructed to return exactly one strict JSON object:

```json
{
  "action": "restart_service",
  "rationale": "One additional approved restart may distinguish a transient failure."
}
```

The only accepted actions are `restart_service` and `none`. `RecoveryPlanProposalParser` rejects markdown fencing, extra fields, alternate targets, commands, credentials, and unknown action names. Node and service identity are copied from the incident by deterministic code; the model never chooses them.

A valid restart proposal becomes an `elevated` `RecoveryPlan` with status `pending_approval`. Plans are currently process-local and are not durable authority.

`recovery_plan_approve` requires the separate `RECOVERY_APPROVAL_TOKEN`. The token is loaded only from the control-host environment and is never exposed through Recovery MCP. A valid approval executes exactly one typed action against the already-bound target and immediately performs a fresh inspection. The plan becomes `executed` only when the approved action completes; failed verification produces a failed plan and returns the incident to `human_required`.

This is an explicit product gate, not model authorization. The current token mechanism is an E2E foundation. Production identity-aware approvals, approver attribution, durable audit records, revocation, expiry, and host-native confirmation remain future work.

## Built-in Service Watches

Each configured service receives a built-in watch by default. `watchEnabled` may disable it and `watchIntervalSeconds` controls its interval, defaulting to 30 seconds.

`RecoveryWatchService` is a product lifecycle service, not a replacement generic scheduler. It owns only Recovery Agent watch cadence and short-lived watch execution state. Due watches delegate to `RecoveryControlRuntime.recoverService`, preserving one recovery path for user-triggered and automatic execution.

Watch invariants:

- only one timer-driven watch cycle executes at a time;
- an explicit `watch_run` waits for any active cycle before forcing all configured watches;
- a watch that has not reached its interval is skipped;
- watch errors are recorded in the watch runtime state rather than terminating future cycles;
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

The focused investigator and bounded planner are implemented. The larger planned Strands graph (triage router, specialist investigators, critic, postmortem, richer evidence collection) is not yet implemented and must not be presented as working behavior.

## Incident State

`InMemoryIncidentRepository` and `InMemoryRecoveryPlanRepository` currently own process-local incident and plan state. They are explicit runtime-only state and are not durable authority. Restarting the control process loses this history and any pending plan.

Before production promotion, incident/audit history requires a durable repository with explicit retention, migration, cleanup, and recovery ownership. The current repository must not silently become the production history store.

## Demo

`recovery-agent demo` starts an ephemeral loopback node HTTP server and drives the same control gateway, policy resolver, orchestrator, incident repository, and MCP tool router used by the real runtime.

The demo deliberately uses a fake investigator because model-provider access is external. Its output is labeled `SIMULATED DEMONSTRATION` and must remain distinguishable from physical product/model evidence.

## Implemented Validation

The current local E2E harness covers:

- stopped service -> typed restart -> fresh verification -> incident resolved;
- repeatedly failing service -> bounded restart budget -> investigation -> strict typed proposal -> pending approval;
- real local HTTP boundary between the control gateway and demo node runtime;
- bearer authentication on the node boundary;
- MCP intention routing into the deterministic control runtime;
- simulated fleet sweep across recovery and escalation paths;
- recurring service watch due/skip behavior and forced watch execution through MCP;
- rejection of planner target/command injection fields and non-JSON output;
- out-of-band approval token rejection before mutation;
- approved typed restart -> fresh verification -> executed/failed plan state.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. The following are not yet claimed:

- real `npm install` and generated dependency lockfile in a networked development environment;
- physical `@modelcontextprotocol/server@2.0.0` stdio validation with MCP Inspector/current host;
- physical `@strands-agents/sdk@1.16.0` validation inherited from the bridge;
- authorized model invocation through the bridge;
- clean-directory package/npx install-and-run smoke test;
- durable incident/audit persistence;
- built-in node/deployment/dependency/certificate/recovery-readiness watch packs and semantic user-watch compilation;
- full Strands triage/specialist/critic/postmortem graph beyond the implemented focused investigator/planner;
- production identity-aware approval workflow with approver attribution, expiry/revocation, durable audit, and host-native confirmation;
- outbound node enrollment, credential rotation, mutual authentication, and production remote transport;
- Docker/Kubernetes/network/database/Minecraft adapters;
- recovery budgets beyond restart attempts, including rollback/failover/drain/quarantine/reboot policy;
- production demo evidence showing real action -> execution -> result/state change on an authorized disposable service.

## Final Rules Summary

- AI does not run on production nodes.
- Deterministic software owns checks, authorization, mutation, budgets, and verification.
- Strands is an investigation/planning runtime, never the authorization boundary.
- Model plans cannot choose targets; deterministic incident state binds node/service identity.
- Node operations are typed and configured; arbitrary shell execution is not a normal capability.
- Every mutation is followed by fresh deterministic verification.
- Built-in service watches reuse the same bounded recovery path as user-triggered recovery.
- Elevated recovery plans remain inert until an out-of-band approval token is verified.
- Unknown or exhausted recovery paths escalate instead of looping indefinitely.
- Demo behavior remains clearly labeled when simulated.
- The system remains Draft until physical external/runtime evidence and accountable review are complete.
