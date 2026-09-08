# Recovery Agent

Recovery Agent is a control-host recovery runtime for Linux services. It keeps AI execution away from production nodes: ChatGPT, Claude, Codex, or another MCP host talks to one control runtime, while production machines expose only narrow typed health and recovery operations.

**Agents for Humans track:** Professional

> **Current status:** Draft E2E foundation. Deterministic service recovery, application-level HTTP/TCP health probes, service/node/readiness watches, rolling restart budgets, dependency-aware recovery, typed Strands proposals, owner-only human approval, concurrency/suppression barriers, and partial-fleet operation are runnable. Remote production transport, physical npm/Strands/MCP validation, durable audit state, richer watch packs, and broader adapters remain promotion gates.

## Current runtime

```text
MCP host
  -> Recovery MCP server
      -> deterministic control runtime
          -> partial-fleet inspection
          -> recovery readiness inspection
          -> node HTTP boundary
              -> fixed systemd service mappings
              -> fixed HTTP/TCP application probes
              -> Linux resource evidence
          -> recurring node-resource watches
              -> memory / swap / disk / inode / load / read-only evidence
              -> node-health incident lifecycle
          -> recurring service watches
          -> recurring recovery-readiness watch
          -> dependency graph + dependency-first sweeps
          -> rolling automatic restart budget
          -> per-target in-flight recovery coalescing
          -> pending-plan / human-required suppression
          -> fresh verification after every mutation
          -> Strands investigation + strict typed proposal after deterministic exhaustion

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

The demo starts an ephemeral loopback node server and drives the same HTTP gateway, control runtime, watch path, incident path, and planner boundary used by the product. It is explicitly labeled `SIMULATED DEMONSTRATION` and never pretends fake model/service behavior is production evidence.

## Node agent

```bash
export RECOVERY_NODE_TOKEN_EAST_01='replace-with-a-long-random-secret'
recovery-agent node ./node.json
```

Public service IDs map to configured systemd units. Remote callers cannot supply a unit name, shell command, health URL, or health port.

Node configuration may attach fixed HTTP/TCP application probes to a service. Probe targets are local node configuration, not model/MCP arguments. HTTP URLs are restricted to HTTP(S), embedded URL credentials are rejected, timeouts are bounded, and TCP ports are validated. A running systemd unit with a failed configured probe is unhealthy and carries probe evidence.

The production Linux node runtime also exposes deterministic resource evidence through `/v1/node`. `LinuxNodeResourceProbe` reads memory/swap from `/proc/meminfo`, load/CPU/uptime from Node OS APIs, root filesystem capacity/inodes from `statfs`, and root mount mode from `/proc/self/mountinfo`; it does not execute a shell command or write a probe file.

The current node HTTP transport defaults to loopback. Do not expose it directly to the public Internet. Remote production use still requires a private network/tunnel or trusted TLS termination until outbound enrollment, mTLS, and credential rotation are implemented.

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
- `incident_list`
- `incident_inspect`
- `recovery_plan_list`
- `recovery_plan_inspect`

Approval and rejection are deliberately **not MCP tools**.

## Recovery Readiness

`recovery_readiness` answers a different question from ordinary health: **can each configured target actually be recovered right now, and what would block it?** The report is read-only and classifies services as:

- `ready`: automatic recovery is currently available;
- `limited`: reachable and not blocked, but automatic restart is unavailable because of policy or rolling budget;
- `blocked`: dependency health or human-owned incident/approval state currently blocks automatic recovery;
- `unreachable`: the target cannot currently be inspected.

Each service includes current target reachability/health, restart policy, the **same live rolling budget** used by recovery execution, dependency reachability/health, pending plan IDs, human-required/dependency-blocked incidents, and explicit reasons.

A healthy service can therefore be `limited`. Green workload health does not magically replenish an exhausted restart budget. Recovery Readiness does not open incidents, spend budget, or execute a recovery action.

A built-in readiness watch runs every five minutes by default. It records the latest report/error in watch state. The combined watch coordinator runs node watches, then service watches, then readiness so the readiness report observes the latest deterministic state from that cycle.

## Rolling automatic restart budgets

`maxRestartAttempts` is a rolling automatic-recovery ceiling, not a fresh allowance on every watch cycle. `restartBudgetWindowSeconds` defaults to 600 seconds. Every actual automatic restart consumes budget, including successful restarts. When the window is exhausted, Recovery Agent performs no restart and moves directly into investigation/planning.

The automatic budget ledger is process-local today. Durable budget authority across control-host restart remains a production promotion gate.

## Dependency-aware recovery

Services can declare same-node or cross-node dependencies. Configuration rejects unknown targets, duplicates, self-dependencies, and cycles.

For an unhealthy dependent service, Recovery Agent verifies dependencies before mutation. An unhealthy/unreachable dependency blocks target mutation with zero restart attempts. Once dependencies recover, normal bounded target recovery resumes. `health_sweep` orders dependencies before dependents. Human-approved execution also re-checks dependencies.

## Recovery suppression barriers

Recovery Agent deliberately stops retrying once deterministic ownership changes:

- same-target concurrent recovery shares one in-flight operation;
- `pending_approval` suppresses automatic mutation until decision or verified external recovery;
- `human_required` suppresses automatic mutation/Strands reinvocation until verified external recovery;
- `dependency_blocked` suppresses target mutation while dependencies remain unhealthy.

## Partial-fleet operation

`fleet_status` isolates node failures. One unreachable node does not erase reachable nodes or stop bounded work elsewhere. `node_inspect` provides direct read-only inspection for a configured node.

## Built-in Linux Node Watch

Every configured node receives deterministic resource monitoring for memory, swap, root-filesystem byte usage, inode usage when supported, root read-only state when determinable, normalized one-minute load, and uptime.

Default limits:

```text
memory used                 > 92%
swap used                   > 80%
root filesystem bytes used  > 90%
root filesystem inodes used > 90%
1m load average / CPU       > 2.0
root filesystem read-only   must be false
```

Node Watch is read-only. Degraded/unreachable evidence opens or updates process-local node-health incidents; fresh healthy evidence resolves them. It does not automatically reboot, drain, or mutate the node.

`watch_list` returns service watches, node watches, node-health incidents, and Recovery Readiness state. `watch_run` forces node, service, and readiness passes.

## Human approval

A valid Strands proposal is target-bound by deterministic incident state and stored as `pending_approval`. The planner may return only strict `{action, rationale}` JSON and cannot supply another target, command, credential, or arbitrary argument.

```bash
export RECOVERY_APPROVAL_TOKEN='replace-with-a-separate-long-secret'
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

The owner-only approval socket is mode `0600`. Wrong-token requests execute no mutation. A valid approval executes exactly one already-bound typed action, re-checks dependencies, and freshly verifies systemd + application health.

## Built-in service watches

Configured services are watched by default every 30 seconds unless disabled. Systemd lifecycle and configured HTTP/TCP probes compose into one service snapshot. Watches reuse the exact `recoverService` path, so budgets, dependencies, suppression, Strands escalation, and verification cannot drift into a second behavior.

## Strands boundary

Recovery Agent depends on `@tjxjnoobie/custom-strands-bridge`, not directly on `@strands-agents/sdk`. Strands investigates bounded evidence and may propose one strict bounded action after deterministic recovery exhausts. It cannot retarget, approve, or mutate.

Optional investigation configuration:

- `RECOVERY_AGENT_MODEL_ID`
- `RECOVERY_AGENT_INVESTIGATION_MCP_URL`
- `RECOVERY_AGENT_INVESTIGATION_MCP_AUTHORIZATION`

## Development

Node.js 22+ is required.

```bash
npm install
npm run check
```

The bridge is temporarily pinned to exact Git commit `677f141a73fcc1bed23edf02c8fdfbd116fd034d` while its own promotion gates remain open.

See `docs/recovery-agent/RECOVERY_AGENT_FINAL_DRAFT.md` for the owning design and validation contract.
