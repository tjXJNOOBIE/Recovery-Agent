# Recovery Agent

Recovery Agent is a control-host recovery runtime for Linux services. It keeps the AI runtime away from production nodes: the control host exposes a small MCP surface to ChatGPT, Claude, Codex, or another MCP host, while production nodes expose only typed health and recovery operations.

**Agents for Humans track:** Professional

> **Current status:** Draft E2E foundation. The simulated recovery path, recurring service watches, typed Strands recovery proposals, and explicit approval gate are runnable. Real remote-node transport, physical npm/Strands/MCP SDK validation, durable incident/plan storage, broader watch packs, and broader adapters remain promotion gates.

## What is implemented

```text
MCP host
  -> Recovery MCP server
      -> deterministic control runtime
          -> node HTTP boundary
              -> systemd adapter
          -> recurring service watches
          -> incident timeline
          -> bounded recovery policy
          -> verify after mutation
          -> Strands investigation + strict typed proposal only after deterministic recovery is exhausted
          -> out-of-band approval token before elevated plan execution
```

The current node action catalog is intentionally tiny: inspect service state and restart a configured systemd unit. There is no arbitrary shell execution surface.

## Demo

The demo is explicitly simulated and never touches production services:

```bash
npm install
npm run demo
```

It starts an ephemeral loopback node server and drives it through the same HTTP gateway and recovery core used by the real control runtime.

The demo includes two services:

- `worker`: stopped, then restored by deterministic restart and verification.
- `payments`: remains failed after its automatic restart budget, then receives a simulated investigation and a pending elevated recovery plan. The demo does not auto-approve it.

Every demo result is labeled `SIMULATED DEMONSTRATION`.

## Run a node agent

Create a node config based on `examples/node.example.json`, keep the token in the environment, then start the node process:

```bash
export RECOVERY_NODE_TOKEN_EAST_01='replace-with-a-long-random-secret'
recovery-agent node ./node.json
```

The node process maps public service IDs to fixed systemd unit names. Calls cannot supply a unit name or shell command.

The current E2E transport defaults to loopback HTTP. Do not expose it directly to the public Internet. Remote production deployment still requires a private network/tunnel or a trusted TLS termination layer until the planned outbound enrollment and mutual-authenticated node transport are implemented.

## Run the MCP control host

Create a control config based on `examples/control.example.json`. The control process reads each node token from the environment and exposes Recovery Agent over stdio:

```bash
export RECOVERY_NODE_TOKEN_EAST_01='replace-with-the-same-secret'
export RECOVERY_APPROVAL_TOKEN='replace-with-a-separate-long-approval-secret'
recovery-agent mcp ./control.json
```

Recovery Agent uses the official MCP TypeScript server SDK v2, which serves current `2026-07-28` MCP clients and legacy 2025-era clients from the same stdio entry point.

Current MCP tools:

- `fleet_status`
- `service_inspect`
- `service_recover`
- `health_sweep`
- `watch_list`
- `watch_run`
- `incident_list`
- `incident_inspect`
- `recovery_plan_list`
- `recovery_plan_inspect`
- `recovery_plan_approve`
- `recovery_plan_reject`

`service_recover` and `health_sweep` are bounded by configured policy. If that budget is exhausted, Strands may propose only a strict `{action, rationale}` plan. The deterministic core fixes the target from the incident, validates the action catalog, and stores the plan as `pending_approval`.

`recovery_plan_approve` requires `RECOVERY_APPROVAL_TOKEN`, which is never returned by Recovery MCP. Without that out-of-band token, a proposed elevated action cannot execute. Approval still performs exactly one typed action followed by a fresh health inspection. `recovery_plan_reject` uses the same gate and records the rejection.


## Built-in service watches

Configured services are watched by default when the MCP control host runs. Each service defaults to a 30-second interval and can be tuned or disabled independently:

```json
{
  "id": "payments-api",
  "restartAllowed": true,
  "maxRestartAttempts": 2,
  "watchEnabled": true,
  "watchIntervalSeconds": 30
}
```

The watch service is deliberately product-specific rather than a second general scheduling framework. A due watch calls the same `recoverService` path used by MCP, so health checks, recovery budgets, Strands escalation, and verification cannot quietly drift into separate behavior. Overlapping watch cycles are serialized and watch failures are recorded in runtime watch state instead of killing the recurring loop.

`watch_list` exposes the latest state for each configured watch. `watch_run` forces all configured watches to run immediately through the bounded recovery path.

## Strands investigation

Strands remains behind `@tjxjnoobie/custom-strands-bridge`; this repository does not depend directly on `@strands-agents/sdk`.

The deterministic control runtime invokes Strands only after a service cannot be restored within its configured restart budget. The investigator returns diagnosis text. A separate planner invocation may then return only strict JSON with `action` set to `restart_service` or `none`, plus a rationale. Model output cannot name or change the target and cannot contain commands or credentials. Unsafe or malformed planner output fails closed into human escalation.

Optional investigation configuration:

- `RECOVERY_AGENT_MODEL_ID`
- `RECOVERY_AGENT_INVESTIGATION_MCP_URL`
- `RECOVERY_AGENT_INVESTIGATION_MCP_AUTHORIZATION`

No external investigation MCP is configured by default.

## Development

Node.js 22+ is required.

```bash
npm install
npm run check
```

The bridge is temporarily pinned to exact Git commit `677f141a73fcc1bed23edf02c8fdfbd116fd034d` while its own promotion gates remain open.

See `docs/recovery-agent/RECOVERY_AGENT_FINAL_DRAFT.md` for the current owning design and validation contract.
