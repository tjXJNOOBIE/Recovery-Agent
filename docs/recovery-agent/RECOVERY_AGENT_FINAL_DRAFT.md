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
              -> append investigation evidence
              -> require human intervention
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

Secrets do not live in the config document.

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

This catalog represents user intentions rather than mirroring every operating-system verb.

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

The current E2E investigator:

1. receives a typed incident/evidence request;
2. serializes the bounded evidence into the product prompt;
3. invokes Strands;
4. returns the diagnosis summary;
5. closes the Strands runtime in `finally`;
6. cannot execute a node mutation.

`RECOVERY_AGENT_INVESTIGATION_MCP_URL` may add an investigation-only MCP server to the Strands runtime. No external investigation MCP is enabled by default.

The planned Strands graph (triage, specialist investigators, typed recovery planner, critic, postmortem) is not yet implemented and must not be presented as working behavior.

## Incident State

`InMemoryIncidentRepository` currently owns process-local incident state. It is explicit runtime-only state and is not durable authority. Restarting the control process loses this history.

Before production promotion, incident/audit history requires a durable repository with explicit retention, migration, cleanup, and recovery ownership. The current repository must not silently become the production history store.

## Demo

`recovery-agent demo` starts an ephemeral loopback node HTTP server and drives the same control gateway, policy resolver, orchestrator, incident repository, and MCP tool router used by the real runtime.

The demo deliberately uses a fake investigator because model-provider access is external. Its output is labeled `SIMULATED DEMONSTRATION` and must remain distinguishable from physical product/model evidence.

## Implemented Validation

The current local E2E harness covers:

- stopped service -> typed restart -> fresh verification -> incident resolved;
- repeatedly failing service -> bounded restart budget -> investigation -> human escalation;
- real local HTTP boundary between the control gateway and demo node runtime;
- bearer authentication on the node boundary;
- MCP intention routing into the deterministic control runtime;
- simulated fleet sweep across recovery and escalation paths;
- recurring service watch due/skip behavior and forced watch execution through MCP.

## Remaining Promotion Gates

This document remains `FINAL_DRAFT`. The following are not yet claimed:

- real `npm install` and generated dependency lockfile in a networked development environment;
- physical `@modelcontextprotocol/server@2.0.0` stdio validation with MCP Inspector/current host;
- physical `@strands-agents/sdk@1.16.0` validation inherited from the bridge;
- authorized model invocation through the bridge;
- clean-directory package/npx install-and-run smoke test;
- durable incident/audit persistence;
- built-in node/deployment/dependency/certificate/recovery-readiness watch packs and semantic user-watch compilation;
- Strands triage/investigator/planner/critic graph and typed recovery plans;
- human approval workflow for higher-risk recovery levels;
- outbound node enrollment, credential rotation, mutual authentication, and production remote transport;
- Docker/Kubernetes/network/database/Minecraft adapters;
- recovery budgets beyond restart attempts, including rollback/failover/drain/quarantine/reboot policy;
- production demo evidence showing real action -> execution -> result/state change on an authorized disposable service.

## Final Rules Summary

- AI does not run on production nodes.
- Deterministic software owns checks, authorization, mutation, budgets, and verification.
- Strands is an investigation/planning runtime, never the authorization boundary.
- Node operations are typed and configured; arbitrary shell execution is not a normal capability.
- Every mutation is followed by fresh deterministic verification.
- Built-in service watches reuse the same bounded recovery path as user-triggered recovery.
- Unknown or exhausted recovery paths escalate instead of looping indefinitely.
- Demo behavior remains clearly labeled when simulated.
- The system remains Draft until physical external/runtime evidence and accountable review are complete.
