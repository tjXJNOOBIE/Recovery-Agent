# Repository instructions

`Recovery-Agent` owns the Recovery Agent product and control plane. The authoritative application backend is Java. Shared provider-neutral AI execution and Java MCP capability publication belong in `TavallStudios/function-catalog`. Native Strands lifecycle/model-tool reasoning belongs in the standalone `tjXJNOOBIE/strands-bridge` MCP runtime service.

## Authoritative engineering guidance

Before changing code, architecture, tests, packaging, lifecycle, or documentation, read the current versions of **all** shared Tavall quality documents in `TavallStudios/tavall-docs`, including:

- [`CODE_ARCHITECTURE.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/CODE_ARCHITECTURE.md)
- [`DOCUMENTATION_STANDARDS.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/DOCUMENTATION_STANDARDS.md)
- [`GIT_WORKFLOW.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/GIT_WORKFLOW.md)
- every active chapter under [`docs/quality/code-architecture/`](https://github.com/TavallStudios/tavall-docs/tree/main/docs/quality/code-architecture), including `APPLICATION_OWNED_MUTABLE_MAPS.md`.

`CODE_ARCHITECTURE.md` wins if a detailed chapter conflicts with it. Repository-local rules may strengthen those documents but must not silently weaken them.

Use `TavallStudios/Tavall-Architecture-Tests` as the canonical executable architecture-test source. During the current migration, CI consumes the active executable consumer implementation from PR #6 until that implementation is promoted and released.

## Product architecture

```text
operator / ChatGPT / control client
    -> Recovery Agent Java MCP/control surface
        -> Java recovery policy / approvals / durability / deterministic node capabilities
        -> Tavall AIAgentRuntime
            -> StrandsAgentProvider
                -> standalone strands-bridge over MCP
                    -> native Strands reasoning
                    -> policy-filtered Java Function Catalog MCP capabilities
```

**Java owns the application. Strands owns reasoning. MCP joins them.**

The standalone Strands service is not the Recovery Agent backend and must never become the authority for recovery mutations, approvals, persistence, node transport, or policy.

## Product boundaries

- Java owns product lifecycle, control/MCP transport, authorization, recovery policy, restart budgets, approval boundaries, incidents/plans, durable state, watch coordination, deterministic node capabilities, and product orchestration.
- Use Tavall DI for managed Java collaborators and Function Catalog for AI-callable Java capabilities.
- Product Java code must not depend on `@strands-agents/sdk` or import/embed the npm `strands-bridge` package. Invoke Strands through the Function Catalog `AIAgentRuntime` / `StrandsAgentProvider` boundary.
- `strands-bridge` must not reimplement Recovery policy, restart logic, approval state, durable state, node transport, or Tavall Java infrastructure in TypeScript.
- Do not recreate `tavall-di`, Tavall Cache, Registry, Database, Concurrency, EventBus, Scheduler, or other Java-owned systems in TypeScript.
- Existing TypeScript is migration/reference behavior until the corresponding Java slice has physical parity evidence. Port behavior before removing it; do not maintain two authoritative backends.
- The model never becomes recovery authority. A model may analyze evidence and propose within an explicitly supplied bounded capability view; deterministic Java policy owns whether any effect is legal and whether it executed.
- Do not expose restart/recovery mutation to Strands until restart policy, dependency health gates, attempt budgets, operation exclusion, incidents/escalation, approvals, and required durable checkpoints for that path are all present in Java and tested.
- Approval remains a distinct trusted control boundary and is not an ordinary agent tool.
- Preserve fail-closed restart behavior after interrupted/unknown outcomes. A durable approval without a durable verified execution result must not be interpreted as successful execution after restart.
- Loopback plaintext compatibility transport remains loopback-only. Remote control transport must retain authenticated TLS/session semantics when ported.
- Product prompts, permissions, tool exposure, workflows, and user-facing policy belong here.
- Do not invent MCP operation names or claim integration behavior until backed by a real connected catalog/runtime.
- Do not add application-owned mutable keyed state. Classify runtime state through Tavall Registry/Cache/Database/distributed or dedicated operation ownership according to current Tavall docs.
- New Tavall-owned production `*Repository` types are prohibited. Durable entity behavior follows the checked-in Tavall Database contract.
- Keep Strands visibly responsible for reasoning/model-tool iteration while Java remains authoritative for deterministic effects.

## Migration state

The Java migration is intentionally sliced by authority rather than by filename.

The first Java slice owns control configuration, node observation, Function Catalog publication, provider-neutral reasoning, and the product process lifecycle. Its Strands view is read-only (`fleet_status`, `node_inspect`, `service_inspect`). Recovery mutation remains unavailable from the Java/Strands path until the complete deterministic policy/effect slice is ported.

The existing `state-authority` Java sidecar contains useful durable revision/CAS and append-only audit semantics, but its process/NDJSON boundary is migration debt. Do not expand that boundary. As the Java application absorbs durable state ownership, use Tavall Database through current Tavall DI/entity contracts rather than teaching Java to communicate with its own persistence code through another local process.

## Tests and validation

- Use delegate-style tests against real product classes.
- Tavall-managed Java behavior should use production-equivalent Tavall DI composition in tests.
- Fake only true external boundaries such as node agents, the standalone bridge process, MCP transport, model providers, or external cloud/service APIs.
- Never report a TypeScript bridge shim, schema-only check, or mock as physical runtime validation.
- `check` must consume the canonical Tavall architecture-test plugin/modules that apply to this repository.
- The Java migration CI must validate the full shared Function Catalog provider and standalone bridge before validating Recovery.
- Require a physical Java -> standalone Strands stdio MCP -> Java Streamable HTTP Function Catalog round trip before declaring a Java Strands slice complete.
- Cover partial node failures, dependency topology rejection, mutation suppression, restart-budget exhaustion, approval boundaries, durability/reconciliation, cleanup, and shutdown as those slices move.
- Record exactly which checks ran and keep Draft PRs blocked while required external/runtime evidence is unavailable.

## Git

Follow the shared Tavall PR-first workflow: `working/*` branches, linked issues for architecture-crossing work, structured commits, truthful validation, docs synchronized with touched systems, and accountable review before `main`.
