# Recovery Agent

Recovery Agent is a control-host recovery runtime for Linux services. It keeps AI execution away from production nodes: ChatGPT, Claude, Codex, or another MCP host talks to one control runtime, while production machines expose only narrow typed health and recovery operations.

**Agents for Humans track:** Professional

> **Current status:** Draft E2E foundation. Deterministic recovery, recurring watches, rolling restart budgets, dependency-aware recovery, typed Strands proposals, owner-only human approval, concurrency/suppression barriers, and partial-fleet operation are runnable. Remote production transport, physical npm/Strands/MCP validation, durable audit state, broader watch packs, and broader adapters remain promotion gates.

## Current runtime

```text
MCP host
  -> Recovery MCP server
      -> deterministic control runtime
          -> partial-fleet inspection
          -> node HTTP boundary
              -> fixed systemd service mappings
          -> recurring service watches
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

Public service IDs map to configured systemd units. Remote callers cannot supply a unit name or shell command.

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

## Rolling automatic restart budgets

`maxRestartAttempts` is a rolling automatic-recovery ceiling, not a fresh allowance on every watch cycle. `restartBudgetWindowSeconds` defaults to 600 seconds:

```json
{
  "id": "payments-api",
  "restartAllowed": true,
  "maxRestartAttempts": 2,
  "restartBudgetWindowSeconds": 600,
  "watchEnabled": true,
  "watchIntervalSeconds": 30
}
```

Every actual automatic restart consumes budget, including successful restarts. A flapping service therefore cannot recover briefly and receive an infinite new restart allowance 30 seconds later. When the window is exhausted, Recovery Agent performs no restart and moves directly into investigation/planning with budget evidence attached to the incident.

The automatic budget ledger is process-local today. Durable budget authority across control-host restart remains a production promotion gate.

## Dependency-aware recovery

Services can declare same-node or cross-node dependencies:

```json
{
  "id": "payments-api",
  "restartAllowed": true,
  "maxRestartAttempts": 2,
  "dependencies": [
    { "serviceId": "postgres" }
  ]
}
```

A missing `nodeId` means the dependency is on the same node. Configuration rejects unknown dependency targets, duplicates, self-dependencies, and cycles.

For an unhealthy dependent service, Recovery Agent verifies dependencies before mutation. If a dependency is unhealthy, the target enters `dependency_blocked` and receives **zero restart attempts**. Once dependencies recover, the block is resolved and normal bounded target recovery resumes. `health_sweep` orders dependencies before dependents so a single sweep can recover the root dependency first.

The owner-approved executor also re-checks dependencies. Human approval does not waive the dependency health gate.

## Recovery suppression barriers

Recovery Agent deliberately stops retrying once deterministic ownership changes:

- Concurrent recovery calls for the same node/service share one in-flight operation.
- `pending_approval` suppresses further automatic mutation until a human decides the plan or verified external recovery supersedes it.
- `human_required` suppresses further automatic mutation until fresh inspection proves external recovery.
- `dependency_blocked` suppresses target mutation while declared dependencies remain unhealthy.

These barriers keep a recurring watch from turning into a restart loop wearing an automation badge.

## Partial-fleet operation

`fleet_status` isolates node failures. If one node is unreachable, reachable nodes remain visible and recoverable, while the response includes explicit `unreachableNodes` evidence. `health_sweep` continues bounded work on reachable nodes instead of failing the entire fleet because one gateway refused a connection.

`node_inspect` provides direct read-only inspection for a configured node.

## Human approval

A valid Strands proposal is target-bound by deterministic incident state and stored as `pending_approval`. The planner may return only strict `{action, rationale}` JSON and cannot supply another node/service, command, credential, or arbitrary argument.

On the control host:

```bash
export RECOVERY_APPROVAL_TOKEN='replace-with-a-separate-long-approval-secret'
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

The approval socket defaults to a per-user path under the OS temp directory and can be overridden with `RECOVERY_APPROVAL_SOCKET`. Recovery Agent creates it with mode `0600`. Wrong-token requests execute no mutation. A valid approval executes exactly one already-bound typed action and performs a fresh verification.

## Built-in watches

Configured services are watched by default at a 30-second interval unless disabled. Watches reuse `recoverService`, so rolling budgets, dependency gates, in-flight coalescing, approval suppression, human escalation suppression, Strands escalation, and post-action verification are identical for automatic and user-triggered recovery.

## Strands boundary

Recovery Agent depends on `@tjxjnoobie/custom-strands-bridge`, not directly on `@strands-agents/sdk`.

The current Strands layer has two focused roles:

1. investigate bounded incident evidence;
2. propose one strict bounded action after deterministic recovery is exhausted.

Strands cannot select another target, approve a plan, or execute a node mutation.

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
