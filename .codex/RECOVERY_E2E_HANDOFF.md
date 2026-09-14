# Recovery Agent Java-First E2E Completion Handoff

You are the continuation implementation worker for the existing Recovery Agent Java-first migration. Work directly on the checked-out repository and current branch. Do not recreate completed work, do not start a parallel redesign, and do not stop after analysis or a plan. Continue implementation, run the real validation surfaces, fix failures, commit concern-scoped changes, push them to the existing branch, and leave PR #18 in a genuinely reviewable E2E state.

## Repository and branch

- Repository: `tjXJNOOBIE/Recovery-Agent`
- Working branch: `working/java-first-strands-mcp`
- Pull request: #18, `Changed: migrate Recovery Agent to Java-first Strands MCP architecture`
- Base: `main`
- Known fully-green pre-effect baseline: `6961c7fd33bcf1c80445eed120c6d4fd700247a8`
- Effect-boundary work continued after that baseline. Treat the live branch HEAD as authoritative and inspect it before editing.

## Non-negotiable architecture

The intended system is:

```text
USER / AI CLIENT
ChatGPT / Claude / Codex / Web / CLI / Plugin
             |
             v
        PRODUCT BACKEND
             JAVA
  Tavall DI/tools/policy/approvals/audit/state/events/etc
             |
       agent runtime client
             v
   STRANDS BRIDGE SERVICE
         Node / TS
   Strands SDK/model/tool loop/sessions/providers
             |
        Tool MCP client
             v
      JAVA TOOL CATALOG
```

Canonical rule: **Java owns the application. Strands owns reasoning. MCP joins them.**

Java owns product lifecycle, configuration, node gateways, policy, auth, deterministic recovery decisions, restart budgets, write-ahead durability, incidents, approvals, plans, state, audit, public product MCP/API/CLI, and Tavall infrastructure integration.

Strands owns native agent/model/tool-loop/session/context/streaming/cancel/provider behavior only.

Never reimplement Strands in Java. Never reimplement Tavall DI/Registry/Cache/EventBus/database infrastructure in TypeScript. Never move deterministic recovery authority into prompts or model behavior.

## Authority and coding rules

Before changing architecture-sensitive code:

1. Read this repository's current `AGENTS.md`.
2. Read the current relevant rules from `TavallStudios/tavall-docs`; repository-local docs/tests and current Tavall docs are authoritative over remembered conventions.
3. Consume and run `TavallStudios/Tavall-Architecture-Tests` from its active executable-consumer work until that work is promoted.
4. Follow `DOC_DESIGN_RULES.md` wherever it exists when editing design/architecture documentation.
5. Prefer Tavall DI / `DependencyAccess`; keep platform adapters thin.
6. Do not introduce application-owned mutable keyed runtime maps. The current Java restart effect deliberately serializes effects globally instead of recreating the legacy keyed operation map.
7. Do not invent repository wrappers around Tavall Database. Persistence runtime belongs to Tavall Database.
8. Use focused Service / Handler / Orchestrator naming. Avoid generic `*Manager` names.
9. External state should be typed where the domain is known.
10. Preserve effect ordering and durability. An external mutation must never be reported as successful until deterministic verification proves the postcondition.
11. Do not force-push, reset, flatten, or rewrite branch history. Use concern-scoped commits.

## Shared dependencies

Inspect live refs before relying on these names, but the current migration uses:

- `TavallStudios/function-catalog`
  - branch: `working/strands-mcp-agent-provider`
  - PR #28
  - Java `AIAgentRuntime` + `AIAgentProvider`
  - `StrandsAgentProvider`
  - ephemeral exact-view Java Function Catalog MCP exposure
  - isolated child-process environment for Strands
- `tjXJNOOBIE/strands-bridge`
  - branch: `working/java-first-strands-mcp`
  - PR #9
  - standalone Strands MCP runtime
- `TavallStudios/Tavall-Architecture-Tests`
  - active executable-consumer PR #6 / branch `working/modularize-architecture-tests-20260907` unless already promoted
- Tavall DI/logging/database repositories as required by the Gradle composite/build

The repository CI already demonstrates the required checkout/build topology. Reuse it rather than inventing another dependency graph.

## Current Java migration state

Do not recreate these pieces. Inspect and extend them.

### Java product/runtime

The root Java 25 application is authoritative for the migration. Existing Java composition includes:

- control configuration and topology validation
- loopback node-agent HTTP gateway
- Tavall DI bundle/runtime lifecycle
- Function Catalog registration
- Java product/operator MCP runtime
- `AIAgentRuntime` with standalone Strands provider
- read-only model function view
- physical Java -> standalone Strands stdio MCP -> Java Streamable HTTP Function Catalog round-trip integration test

### Model capability boundary

The Strands/model function view must remain physically limited to exactly the intended observation tools unless architecture is deliberately changed with tests:

- `fleet_status`
- `node_inspect`
- `service_inspect`

Trusted/operator-only capabilities such as `recovery_readiness`, `recovery_invoke`, approvals, plans, and every mutation must remain absent from the model view.

There is an executable Java test that captures the actual `AIFunctionCatalogView` passed to the provider and proves this separation. Keep that guarantee.

### Deterministic policy and readiness

Java now owns:

- `ServiceRecoveryPolicy`
- `RecoveryPolicyResolver`
- deterministic healthy/restart/investigate/human-required decisions
- dependency-aware trusted `recovery_readiness`
- `RecoveryAutomaticRestartBudgetEvaluator`

Readiness consumes authoritative durable restart-attempt history when persistence is configured. Missing/unavailable durability must fail closed for mutation.

### Durable state

The old Java `state-authority` module originally ran as a separate NDJSON sidecar. Do not expand that protocol boundary.

The main Java product now consumes `RecoveryStateAuthority` **in process** through `RecoveryStateAuthorityBuilder`. Preserve the useful semantics:

- PostgreSQL-backed authoritative state
- expected-revision / CAS commits
- append-only immutable audit history
- schema validation/migration

The standalone state-authority main may remain temporarily for migration compatibility, but the final product architecture should not require Java to speak NDJSON to another Java process.

`RecoveryRestartIntentService` now provides durable automatic-restart reservation. Important semantics:

- rolling restart budget is evaluated from authoritative persisted attempts
- budget evaluation + attempt append + audit append happen in the same CAS sequence
- stale revision conflicts reload current state and re-evaluate budget
- denied budget performs no write
- allowed reservation is already the write-ahead intent required before node mutation
- restart attempts survive process restart

Do not regress this into an in-memory counter.

### Internal restart effect boundary

Recent continuation work added:

- typed Java `RecoveryServiceActionResult`
- fail-closed `RecoveryNodeGateway.restartService(...)` default
- real HTTP node-agent `POST /v1/services/{serviceId}/restart`
- real local HTTP contract test with bearer auth
- internal `RecoveryVerifiedRestartService`

`RecoveryVerifiedRestartService` is deliberately **not** an `@AIFunction` yet.

Its intended sequence is:

```text
inspect target
  -> deterministic policy
  -> dependency health
  -> durable rolling-budget reservation + audit under CAS
  -> node restart effect
  -> deterministic re-inspection
  -> success only if verified healthy
```

The service globally serializes automatic restart effects in the Java process rather than recreating the legacy application-owned keyed operation registry. This is intentionally conservative.

Unknown/ambiguous effect outcomes consume the durable attempt and return `OUTCOME_UNKNOWN`; they must never trigger a blind retry. Tests prove the durable intent exists before the fake node receives the restart call and prove an unknown outcome exhausts the one-attempt budget rather than replaying the effect.

## Required completion work

Complete the migration in coherent authority slices. Do not expose half of a mutation protocol.

### 1. Validate the live branch first

- inspect `git status`, current HEAD, PR #18, and current workflow runs
- run the root Java build/tests locally
- run the state-authority tests
- run canonical `architectureTest`
- run the required physical Strands bridge integration
- fix any compile/test/API mismatch in the recent restart-effect slice before proceeding

### 2. Port incident / outcome reconciliation into Java

Before exposing restart mutation publicly, port the legacy incident semantics needed for automatic and approved recovery:

- open incident for unhealthy target
- deterministic event history
- statuses including recovering/resolved/human-required/dependency-blocked or the canonical Java equivalent
- record budget exhaustion without mutation
- record dependency blocks
- record restart intent/effect/verification
- `OUTCOME_UNKNOWN` must become an explicit durable reconciliation/human-required state, never an implicit retry
- state must be durable through the in-process Tavall Database authority
- audit history remains append-only

Prefer typed Java records/entities/domain structures rather than carrying the entire old monolithic TypeScript object graph forward blindly.

### 3. Complete trusted automatic restart orchestration

Once incident state is durable:

- compose deterministic policy + dependencies + durable budget + write-ahead intent + effect + verification + incident update
- preserve global or otherwise canonical exclusion so concurrent callers cannot overlap unsafe effects
- support the configured maximum attempts only when each attempt is independently budget-reserved and the previous outcome is known
- never retry an ambiguous effect
- preserve dependency ordering/gates
- make failure states explicit and testable

Only after these invariants are physically tested may a trusted Java operator capability equivalent to `service_recover` be registered.

Even then, **do not add `service_recover` to the Strands/model allow-list.**

### 4. Port plans and approvals coherently

Port the legacy recovery plan/approval path into Java rather than bypassing it:

- deterministic plan state and lifecycle
- explicit authenticated/trusted approval authority
- approval binds to the exact plan/effect being executed
- pending plan blocks competing automatic mutation where legacy behavior requires it
- approved execution still performs pre-effect validation and post-effect verification
- stale/invalid approval fails closed
- durable audit records approval and execution outcomes

Use a physically separate trusted/operator surface from the model view. Prompts are not an authorization boundary.

### 5. Port health sweep and readiness parity

After automatic recovery is safe:

- port trusted health sweep behavior
- update readiness to include the real Java incident/plan/approval blockers
- report actual durable budget remaining
- report automatic recovery availability truthfully
- preserve partial-fleet behavior when one node is unreachable

### 6. Port remaining product surfaces

Reconcile the existing TypeScript behavior into Java in coherent slices, with tests, including as applicable:

- incident list/inspect
- recovery plan list/inspect
- postmortem generation boundary
- watches: service, node, readiness, certificate, deployment, semantic
- durable watch state and retention semantics
- production node transport, including outbound TLS/session lifecycle and certificate/fingerprint safety
- node health/resource/deployment evidence needed by those watches
- CLI/product MCP equivalents for intended public/trusted tools

Do not move native Strands reasoning loops into Java. Planner/critic/investigator/postmortem reasoning should use `AIAgentRuntime`/Strands through the shared provider with narrowly authorized Java tool views.

### 7. Production transport cutover

The first Java slice intentionally required loopback HTTP. Port the existing authenticated production outbound-TLS/session transport carefully:

- preserve certificate/fingerprint validation
- preserve reconnect/session safety
- keep transport adapters thin
- keep product policy outside transport classes
- add real integration tests equivalent to the existing TypeScript secure-transport validation

Do not weaken transport security merely to make the Java cutover easier.

### 8. Retire migration-only architecture only after physical parity

Do not delete the TypeScript backend early.

Use existing TypeScript source/tests as migration specification until Java parity is proven for the relevant slice. Once the Java product physically covers the product backend and required tests are green:

- archive or remove the superseded TypeScript product/backend cleanly, following the same principle used by the Community Agent migration
- keep only genuinely browser/UI-specific TypeScript if any exists and is still needed
- remove obsolete npm launch/runtime instructions
- remove the Java-to-Java NDJSON sidecar requirement from the authoritative product path
- update README/AGENTS/docs to describe the real final architecture, not migration archaeology

### 9. Validation requirements

Do not call the work complete based on compilation alone.

At minimum finish with green evidence for:

- root Java `clean check` / build / install distribution as applicable
- canonical Tavall architecture tests
- state authority persistence/CAS/audit tests
- durable restart budget across process reopen
- CAS conflict/budget safety
- restart write-ahead ordering before external effect
- unknown-effect suppression/no blind retry
- dependency-blocked recovery
- human-required unknown lifecycle handling
- approval separation
- trusted operator vs Strands model function-view separation
- real local node HTTP contract
- production transport integration
- physical Java -> standalone Strands MCP -> Java Function Catalog MCP topology
- existing fallback/secure transport/production acceptance suites until their behavior is replaced by equivalent Java gates

If a legacy workflow remains because parity is not complete, keep it green. If it becomes obsolete after proven Java parity, replace/remove it deliberately and document the replacement evidence.

### 10. CI and dependency promotion

The current CI checks out migration branches for shared dependencies. Reconcile this before final readiness:

- if Function Catalog PR #28 / Strands bridge PR #9 / Architecture Tests PR #6 have been promoted, move Recovery to promoted refs/artifacts
- otherwise keep the branch pins explicit and truthfully document the dependency
- do not fake a green product by skipping required physical integration tests
- required integration tests must fail when their runtime paths are missing; no silent assumption skip in CI

### 11. PR completion contract

Keep PR #18 Draft while meaningful migration work remains.

When and only when the full Java product cutover is physically validated:

- update the PR body with exact architecture, migrated capabilities, remaining non-blocking items if any, and exact workflow/run evidence
- ensure review threads/checks are reconciled
- mark the PR Ready for Review
- do **not** merge it yourself unless repository policy and an actual submitted review permit it; the goal of this run is a complete, reviewable branch, not bypassing Tavall review discipline

## Execution permissions and environment

This Codex run is intentionally being started on a disposable external runner with unrestricted process privileges. Use them to complete the work:

- run shell commands directly
- install build/runtime dependencies when required
- use network access
- use `gh` with the provided GitHub token
- clone sibling Tavall repositories next to this checkout when Gradle composite builds expect them
- run long builds/tests
- inspect Actions logs/checks
- commit and push to `working/java-first-strands-mcp`

Do not use the privilege level as an excuse to mutate unrelated repositories, machine configuration, or credentials. Do not print, inspect, or exfiltrate secrets. Full permissions are for completing and validating this repository, not wandering around the runner like a raccoon in a server room.

## Git discipline

- preserve history
- no `git reset --hard`
- no force-push
- no branch replacement
- do not squash existing migration history
- make concern-scoped commits with useful messages
- push each coherent validated slice so progress survives the runner
- if another actor advances the branch, fetch/reconcile rather than overwriting their work

## Completion behavior

Do not stop because the task is large. Work step-by-step until the E2E completion contract is satisfied or there is a genuine external blocker that cannot be solved with the available repository, network, GitHub, build, and full runner permissions.

When blocked, exhaust the available implementation paths first and leave the branch in the strongest validated state possible. Record the exact blocker in PR #18 with evidence rather than substituting a vague TODO.

The final Codex message must report:

1. final branch HEAD and commits created;
2. what Java authority/capabilities were completed;
3. what TypeScript/sidecar surfaces were retired or intentionally retained;
4. exact test/build/workflow evidence;
5. PR #18 readiness state;
6. any true external blocker still remaining.
