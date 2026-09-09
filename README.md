# Recovery Agent

Recovery Agent is a control-host recovery runtime for Linux services. It keeps AI execution away from production nodes: ChatGPT, Claude, Codex, or another MCP host talks to one control runtime, while production machines expose only narrow typed health and recovery operations.

**Agents for Humans track:** Professional

> **Current status:** Draft E2E foundation. Deterministic service recovery, HTTP/TCP application health, Linux node/resource/filesystem/clock watches, certificate watch, deployment correlation, Recovery Readiness, semantic service watches, rolling restart budgets, dependency-aware recovery, bounded Strands investigation/planning/critic/postmortem roles, owner-only human approval, concurrency/suppression barriers, and partial-fleet operation are runnable. Remote production transport, physical npm/Strands/MCP validation, durable authority, and broader adapters remain promotion gates.

## Current runtime

```text
MCP host
  -> Recovery MCP server
      -> deterministic control runtime
          -> partial-fleet inspection
          -> Recovery Readiness
          -> node HTTP boundary
              -> fixed systemd service mappings
              -> fixed HTTP/TCP application probes
              -> optional deployment marker evidence
              -> Linux resource evidence
              -> fixed TLS certificate evidence
          -> combined deterministic watches
              -> node/resource/filesystem/clock
              -> certificates
              -> deployment correlation
              -> service recovery
              -> readiness
          -> semantic watch compiler
              -> natural language compiled once by Strands
              -> configured target + bounded interval only
              -> deterministic watch override thereafter
          -> dependency graph + dependency-first sweeps
          -> rolling automatic restart budget
          -> per-target in-flight recovery coalescing
          -> pending-plan / human-required suppression
          -> fresh verification after every mutation
          -> Strands triage -> specialists -> synthesis
          -> strict planner -> veto-only critic
          -> resolved-only structured postmortem

control-host human
  -> recovery-agent approve/reject
      -> owner-only Unix socket (0600)
          -> separate approval token
          -> one already-bound typed action
          -> fresh verification
```

There is no normal arbitrary-shell recovery surface.

## Demo

```bash
npm install
npm run demo
```

The demo starts an ephemeral loopback node server and drives the same HTTP gateway, control runtime, watch path, incident path, and planner boundary used by the product. It is explicitly labeled `SIMULATED DEMONSTRATION` and never presents simulated model/host evidence as physical production evidence.

## Node agent

```bash
export RECOVERY_NODE_TOKEN_EAST_01='replace-with-a-long-random-secret'
recovery-agent node ./node.json
```

Public service IDs map to configured systemd units. Remote/model callers cannot supply a unit name, shell command, health URL/port, TLS target, or deployment marker path.

Configured service health can combine systemd lifecycle with fixed HTTP/TCP probes. A running unit with a failed configured application probe is unhealthy and carries probe evidence. HTTP URL credentials are rejected and timeouts/statuses are bounded.

Linux node evidence is collected without shell execution from `/proc`, Node OS APIs, `statfs`, and mount info. Certificate and deployment targets are also fixed node-side configuration.

The node HTTP transport defaults to loopback. Public-network production use is not claimed until outbound enrollment, mTLS, and credential rotation are implemented.

## Control host

```bash
export RECOVERY_NODE_TOKEN_EAST_01='replace-with-the-same-secret'
export RECOVERY_APPROVAL_TOKEN='replace-with-a-separate-long-approval-secret'
recovery-agent mcp ./control.json
```

Recovery Agent uses the official MCP TypeScript server SDK v2.

Current model-facing MCP tools:

- `fleet_status`
- `recovery_readiness`
- `node_inspect`
- `service_inspect`
- `service_recover`
- `health_sweep`
- `watch_list`
- `watch_run`
- `watch_create`
- `watch_update`
- `watch_remove`
- `incident_list`
- `incident_inspect`
- `incident_postmortem`
- `recovery_plan_list`
- `recovery_plan_inspect`

Approval and rejection are deliberately **not MCP tools**.

## Semantic service watches

Operators can create or update a recurring service-recovery watch using natural language. Strands is used only during the compile step:

```text
"Watch payments every two minutes"
        ↓ Strands once
{ nodeId, serviceId, intervalSeconds, rationale }
        ↓ strict parser + configured-target validation
deterministic RecoveryWatchService override
        ↓
normal recoverService() on every due interval
```

The compiler may select only an already-configured node/service target and an interval from **10 seconds through 24 hours**. It cannot create URLs, ports, commands, credentials, recovery actions, conditions, or new infrastructure.

`watch_create` creates one semantic override for a configured service target. `watch_update` may change its interpreted cadence/rationale but cannot silently retarget it. `watch_remove` restores the repository-configured built-in interval; when the service had no built-in watch, the dynamic watch disappears entirely.

`watch_run` and recurring execution do **not** invoke Strands. The model is not called every interval to rediscover what two minutes means.

Semantic watch definitions are process-local in the current E2E foundation. Durable watch authority across control-host restart remains a production promotion gate.

## Recovery Readiness

`recovery_readiness` answers whether each configured target can actually be recovered right now. Results are `ready`, `limited`, `blocked`, or `unreachable` using the same live rolling budget, dependency, policy, plan, and incident state used by execution. It is read-only and runs automatically every five minutes.

## Rolling automatic restart budgets

`maxRestartAttempts` is a rolling automatic ceiling rather than a fresh allowance every watch cycle. The default window is 600 seconds. Successful automatic restarts consume budget too, so flapping services cannot earn infinite retries by briefly recovering.

## Dependency-aware recovery

Dependencies are validated at config load for target existence, duplicates, self-dependencies, and cycles. An unhealthy/unreachable dependency blocks downstream mutation with zero restart-budget use. `health_sweep` orders dependencies before dependents and approved execution re-checks them.

## Recovery suppression barriers

- Same-target concurrent recovery shares one in-flight operation.
- `pending_approval` suppresses duplicate automatic mutation/plans until decision or verified external recovery.
- `human_required` suppresses repeated mutation/Strands loops until verified external recovery.
- `dependency_blocked` suppresses downstream mutation while prerequisites remain unhealthy.

## Partial-fleet operation

One unreachable node does not erase reachable nodes from `fleet_status` or stop bounded work elsewhere.

## Built-in Linux Node Watch

Read-only evidence includes memory, swap, root filesystem bytes/inodes/read-only state, one-minute load per CPU, uptime, and midpoint-based clock drift. Default limits are 92% memory, 80% swap, 90% root bytes, 90% root inodes, 2.0 load/CPU, writable root, and <=30s clock drift.

Resource pressure or clock skew opens/updates node-health incidents but does not automatically reboot, drain, or rewrite system time.

## Certificate Watch

Configured TLS targets are inspected every six hours by default. Warning begins at <=30 days remaining, critical at <=7 days, and authorization failure is critical. The probe can observe an invalid peer certificate without treating it as trusted.

Certificate failures do not spend service restart budget.

## Deployment correlation

An optional configured `deploymentMarkerFile` is reduced to SHA-256/timestamp evidence without exposing its contents/path. A marker change starts a 10-minute stabilization window with five-second observation cadence. Deployment regression is captured before service recovery runs, preserving causal evidence before mutation changes the workload.

## Strands boundary

Recovery Agent depends on `@tjxjnoobie/custom-strands-bridge`, not directly on `@strands-agents/sdk`.

After deterministic exhaustion:

```text
strict triage
  -> 1..3 bounded specialists
  -> synthesis
  -> strict restart_service|none planner
  -> veto-only critic
```

Malformed triage falls back safely to one service specialist. The critic can reject an existing bounded proposal but cannot add a recovery action. Model output cannot choose another target, approve a plan, or mutate a node.

## Human approval

```bash
export RECOVERY_APPROVAL_TOKEN='replace-with-a-separate-long-secret'
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

The approval socket is local, owner-only (`0600`), and absent from model-facing MCP. Wrong-token requests execute zero mutation. Valid approval executes exactly one already-bound typed action after dependency re-check and then freshly verifies service/application health.

## Postmortems

`incident_postmortem` is read-only and accepts only resolved incidents. It sends only that incident plus its related recovery plans to Strands and returns a strict typed summary/root cause/contributing factors/recovery/prevention/confidence structure. Unsupported causality must remain `unknown` rather than being invented for narrative satisfaction.

## Development

Node.js 22+ is required.

```bash
npm install
npm run check
```

The bridge remains pinned to exact commit `677f141a73fcc1bed23edf02c8fdfbd116fd034d` while shared bridge promotion gates remain open.

See `docs/recovery-agent/RECOVERY_AGENT_FINAL_DRAFT.md` for the owning design and validation contract.
