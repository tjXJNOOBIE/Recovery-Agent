# Recovery Agent

Recovery Agent is a control-host recovery runtime for Linux services. AI stays away from production nodes: ChatGPT, Claude, Codex, or another MCP host talks to one control runtime, while production machines expose only narrow typed observation and recovery operations.

**Agents for Humans track:** Professional

> **Status:** Draft E2E foundation. Deterministic service recovery, Linux/node/application/certificate/deployment/readiness watches, bounded Strands investigation/planning/critique, human approval, and structured postmortems are implemented. Physical external-package/model validation, durable authority, production remote transport, broader adapters, and richer recovery actions remain promotion gates.

## Product rule

> **Deterministic software observes, authorizes, budgets, orders, executes, and verifies. Strands interprets, investigates, plans, critiques, and explains.**

The model never becomes the mutation or authorization boundary.

## Current topology

```text
MCP host
  -> Recovery MCP server
      -> deterministic control runtime
          -> partial-fleet inspection
          -> recovery readiness
          -> combined watches
              -> Linux node/resource/filesystem/clock
              -> TLS certificates
              -> deployment correlation
              -> service/systemd + HTTP/TCP application health
              -> recovery readiness
          -> dependency graph + ordered health sweep
          -> rolling restart budgets
          -> suppression / in-flight barriers
          -> bounded recovery + fresh verification
          -> Strands triage -> specialists -> synthesis
          -> strict bounded planner -> veto-only critic
          -> pending human-approved plan
          -> resolved-incident postmortem

control-host human
  -> recovery-agent approve/reject
      -> owner-only Unix socket (0600)
          -> separate approval token
          -> dependency re-check
          -> one already-bound typed action
          -> fresh verification
```

There is no normal arbitrary-shell recovery surface.

## Demo

```bash
npm install
npm run demo
```

The demo runs the real control/HTTP/recovery/watch/plan path against an explicitly simulated fleet. Output remains labeled `SIMULATED DEMONSTRATION`; fake model or host evidence is never presented as physical production evidence.

## Node agent

```bash
export RECOVERY_NODE_TOKEN_EAST_01='replace-with-a-long-random-secret'
recovery-agent node ./node.json
```

Public service IDs map to fixed systemd units. Remote callers cannot provide systemd unit names, shell commands, application-health URLs/ports, certificate targets, or deployment marker paths.

A node service can include fixed HTTP/TCP health probes and an optional local deployment marker file. The node can also define fixed TLS certificate targets. Those values are node configuration, not model/MCP operation arguments.

The node runtime exposes:

- fixed systemd lifecycle state;
- configured HTTP/TCP application health evidence;
- deployment marker hash/timestamp evidence without marker contents/path;
- Linux memory, swap, load, uptime, root byte/inode use, and root read-only state;
- configured TLS certificate expiry/trust evidence.

The current node HTTP transport defaults to loopback. Do not expose it directly to the public Internet. Outbound enrollment, mTLS, and credential rotation remain production gates.

## Model-facing MCP tools

Current tools are intentionally intention-level:

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
- `incident_postmortem`
- `recovery_plan_list`
- `recovery_plan_inspect`

Approval and rejection are deliberately **not MCP tools**.

## Deterministic recovery

Recovery Agent applies the same path whether recovery is user-triggered or watch-triggered:

1. coalesce concurrent recovery for the same node/service;
2. respect pending-approval and human-required suppression;
3. inspect systemd + configured application probes;
4. block downstream recovery while declared dependencies are unhealthy/unreachable;
5. spend from the rolling automatic restart budget;
6. perform a fixed typed restart;
7. freshly inspect systemd + application health;
8. escalate to Strands only after deterministic recovery is exhausted.

`maxRestartAttempts` is a rolling ceiling, not a fresh allowance on every watch cycle. The default window is 600 seconds, and successful restarts still consume budget so a flapping service cannot receive infinite fresh attempts.

## Recovery Readiness

`recovery_readiness` asks a different question from workload health: **can this service actually be recovered right now?**

Statuses:

- `ready`: automatic recovery is available;
- `limited`: target is reachable but policy or rolling budget limits automatic recovery;
- `blocked`: dependencies, pending approval, or human ownership prevent automatic recovery;
- `unreachable`: target cannot currently be inspected.

The report reads the same live restart budget, dependency state, incidents, plans, and target evidence used by execution. It opens no recovery incident, consumes no budget, and performs no mutation. A built-in readiness watch runs every five minutes by default.

## Built-in Linux Node Watch

Default deterministic limits:

```text
memory used                 > 92%
swap used                   > 80%
root filesystem bytes used  > 90%
root filesystem inodes used > 90%
1m load average / CPU       > 2.0
root filesystem read-only   must be false
node clock drift            > 30 seconds
```

Clock drift is measured against the midpoint of the node-inspection request and records round-trip time separately to reduce latency bias.

Node Watch opens/updates process-local node-health incidents for degraded or unreachable evidence and resolves them after fresh healthy evidence. It is observation/escalation only. It does not reboot, drain, rewrite time, or mutate the node.

## Application health

A systemd process being `active` is not enough when application probes are configured. Fixed HTTP/TCP probes are evaluated only after systemd is running; all configured probes must pass for the service snapshot to be healthy.

HTTP health config permits only HTTP(S), rejects embedded credentials, validates expected statuses, and bounds timeouts. TCP config fixes host/port and timeout on the node. Caller-supplied probe targets are not supported.

## Certificate Watch

Configured TLS targets are inspected read-only. Evidence includes reachability, authorization/trust, expiry, subject/issuer, fingerprint, and errors.

Defaults:

```text
warning  <= 30 days remaining
critical <= 7 days remaining
critical for TLS authorization failure
```

Certificate inspection runs every six hours by default. Certificate problems have their own watch/incidents and **do not spend service restart budget**, because restarting a process is not certificate renewal despite what desperate automation might wish.

## Deployment correlation

A service may declare a local `deploymentMarkerFile`. Recovery Agent hashes bounded marker metadata/content into SHA-256 evidence and exposes only the hash and deployment timestamp.

The deployment watch establishes a baseline, detects marker changes, and starts a ten-minute stabilization window. During stabilization it checks every five seconds. A new deployment followed by unhealthy service evidence opens a deployment-regression incident.

Combined automatic watch order is:

```text
node -> certificate -> deployment -> service recovery -> readiness
```

Deployment evidence is captured before service recovery can mutate the workload and erase causal clues.

## Strands reasoning boundary

Recovery Agent imports the shared `@tjxjnoobie/custom-strands-bridge`, not `@strands-agents/sdk` directly.

After deterministic recovery exhaustion:

```text
strict triage
  -> 1..3 unique specialist domains
      service | application | dependency | deployment | node | network
  -> synthesis
  -> strict planner {action, rationale}
  -> veto-only critic
  -> deterministic plan creation
```

Malformed triage falls back to one service specialist instead of breaking escalation. Specialist fan-out is capped at three.

The planner may propose only `restart_service` or `none`; it cannot choose the target or include commands, credentials, or arbitrary arguments. The critic can only accept/reject the already-bounded proposal. A rejected or malformed critic path creates **no plan** and fails closed to human intervention.

## Human approval

A valid elevated proposal is target-bound from deterministic incident state and stored `pending_approval`.

```bash
export RECOVERY_APPROVAL_TOKEN='replace-with-a-separate-long-approval-secret'
recovery-agent approve <plan-id>
recovery-agent reject <plan-id> 'reason'
```

The local Unix approval socket is mode `0600`. Wrong-token requests execute no mutation. A valid approval re-checks dependencies, executes exactly one already-bound typed action, and performs fresh verification.

## Incident postmortems

`incident_postmortem` is read-only and only accepts an incident already marked `resolved`. Unresolved incidents are rejected before a Strands runtime is created.

The model returns a strict typed structure containing summary, root cause, contributing factors, recovery, prevention, and confidence. Incident identity is deterministically supplied, and only recovery plans belonging to that incident are included. The prompt requires root cause `unknown` when the evidence does not establish causality and forbids invented people, deployments, actions, or outcomes.

## Development / validation status

Node.js 22+ is required.

```bash
npm install
npm run check
```

The bridge remains pinned to reviewed commit `677f141a73fcc1bed23edf02c8fdfbd116fd034d` while its own promotion gates remain open.

Earlier foundation validation passed 30/30 delegate/E2E tests, strict TypeScript, production build, and package dry-run. Newer slices have focused strict/dependency-free delegate validation plus live Linux, HTTP/TCP, and TLS harnesses.

This execution environment cannot currently resolve external npm/package/model endpoints, so the branch intentionally does **not** claim a fresh full dependency installation, physical MCP Inspector run, physical Strands SDK/model invocation, or clean-directory `npx` smoke test for the newest slices.

## Remaining promotion gates

- networked dependency install + lockfile and clean package smoke;
- physical MCP Inspector/current-host validation;
- physical Strands/provider/model validation through the bridge;
- durable incidents/plans/audit/restart-budget/node/certificate/deployment state;
- production identity-aware approval attribution/expiry/revocation/audit;
- outbound node enrollment, mTLS, and credential rotation;
- Docker/Kubernetes/network/database/Minecraft adapters;
- typed actions beyond systemd restart such as rollback/failover/drain/quarantine/reboot;
- semantic user-created watch compilation;
- physical action -> execution -> resulting state evidence on an authorized disposable service.

See `docs/recovery-agent/RECOVERY_AGENT_FINAL_DRAFT.md` for the owning design and promotion contract.
