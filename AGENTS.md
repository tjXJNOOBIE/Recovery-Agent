# Repository instructions

`Recovery-Agent` owns the Recovery Agent product. Shared Strands lifecycle/MCP behavior belongs in `tjXJNOOBIE/strands-bridge`; product behavior stays here.

## Authoritative engineering guidance

Before changing code, architecture, tests, packaging, lifecycle, or documentation, read the current versions of **all** shared Tavall quality documents in `TavallStudios/tavall-docs`:

- [`CODE_ARCHITECTURE.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/CODE_ARCHITECTURE.md)
- [`DOCUMENTATION_STANDARDS.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/DOCUMENTATION_STANDARDS.md)
- [`GIT_WORKFLOW.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/GIT_WORKFLOW.md)
- [`code-architecture/BUILDERS.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/BUILDERS.md)
- [`code-architecture/CLASSES.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/CLASSES.md)
- [`code-architecture/DEPENDENCY_INJECTION_AND_ORCHESTRATION.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/DEPENDENCY_INJECTION_AND_ORCHESTRATION.md)
- [`code-architecture/EFFECT_SEQUENCES.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/EFFECT_SEQUENCES.md)
- [`code-architecture/ENTITY_PERSISTENCE.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/ENTITY_PERSISTENCE.md)
- [`code-architecture/HANDLERS.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/HANDLERS.md)
- [`code-architecture/INTERFACES_AND_ABSTRACTIONS.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/INTERFACES_AND_ABSTRACTIONS.md)
- [`code-architecture/METHODS.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/METHODS.md)
- [`code-architecture/NAMESPACES_VARIABLES_AND_OOP.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/NAMESPACES_VARIABLES_AND_OOP.md)
- [`code-architecture/REGISTRIES_CACHES_AND_REPOSITORIES.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/REGISTRIES_CACHES_AND_REPOSITORIES.md)
- [`code-architecture/REQUESTS_RESULTS_RESOLVERS_AND_FORMATTERS.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/REQUESTS_RESULTS_RESOLVERS_AND_FORMATTERS.md)
- [`code-architecture/ROUTERS_AND_DELEGATION.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/ROUTERS_AND_DELEGATION.md)
- [`code-architecture/TESTING_AND_GIT.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/TESTING_AND_GIT.md)
- [`code-architecture/UTILITIES.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/UTILITIES.md)
- [`code-architecture/VALIDATION_FALLBACKS_AND_ANTI_PATTERNS.md`](https://github.com/TavallStudios/tavall-docs/blob/main/docs/quality/code-architecture/VALIDATION_FALLBACKS_AND_ANTI_PATTERNS.md)

`CODE_ARCHITECTURE.md` wins if a detailed chapter conflicts with it. Repository-local rules may strengthen those documents but must not silently weaken them.

## Product boundaries

- Do not depend directly on `@strands-agents/sdk`; consume Strands through `@tjxjnoobie/strands-bridge`.
- Do not recreate `tavall-di`, Tavall Cache, Registry, Database, Concurrency, EventBus, Scheduler, or other Java-owned systems in TypeScript. Consume owning runtimes through typed MCP/tool boundaries when needed.
- Product prompts, permissions, tool exposure, workflows, and user-facing policy belong here.
- Do not invent MCP operation names or claim integration behavior until it is backed by the connected catalog.
- Do not add persistence/cache/registry state until authority, lifetime, replacement, stale/miss behavior, and cleanup ownership are explicit.
- Keep Strands visibly responsible for the model/tool loop for hackathon evidence.

## Tests and validation

- Use delegate-style tests against real product classes.
- Fake only true external boundaries such as the bridge runtime, MCP endpoints, model providers, or cloud services.
- Never report the bridge contract shim as physical Strands SDK validation.
- Record exactly which checks ran and keep Draft PRs blocked while required external/runtime evidence is unavailable.

## Git

Follow the shared Tavall PR-first workflow: `working/*` branches, linked issues for architecture-crossing work, structured commits, truthful validation, docs synchronized with touched systems, and accountable review before `main`.
