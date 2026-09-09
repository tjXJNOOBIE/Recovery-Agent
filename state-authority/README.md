# Recovery State Authority

This control-host sidecar owns Recovery Agent's durable PostgreSQL state. It is product-specific Java code that consumes `tavall-database-postgres`; TypeScript never connects to PostgreSQL directly.

The process accepts newline-delimited JSON over stdin and writes one JSON response per request to stdout. It has no public network listener.

Supported operations:

- `ping` — reports whether the Tavall Database authority is available.
- `load` — returns the current durable revision and snapshot.
- `commit` — atomically replaces the snapshot when `expectedRevision` matches the current durable revision.

The current durable snapshot envelope is schema version 2. It contains:

- service recovery `incidents` and timelines;
- typed recovery `plans`;
- `semanticWatches`;
- rolling `restartAttempts`;
- append-only `audit` history;
- node-health incident history;
- certificate incident history;
- deployment incident history;
- deployment baseline, marker, and stabilization state.

Legacy schema-v1 snapshots remain readable. The authority normalizes v1 to safe schema-v2 defaults and emits/commits schema v2 for new durable state. Existing audit history remains append-only: an accepted commit cannot remove or rewrite an existing audit entry.

Scheduler pulse bookkeeping is intentionally not durable domain state. Routine due-run or timer timestamps are excluded so a watch firing without a causal state change does not create meaningless database writes.

Configuration is environment-only:

- `RECOVERY_STATE_JDBC_URL` — required JDBC URL.
- `RECOVERY_STATE_DB_USERNAME` — optional database username.
- `RECOVERY_STATE_DB_PASSWORD` — optional database password.
- `RECOVERY_STATE_GENERATE_SCHEMA` — set to `true` only when this process is allowed to create/update the schema.

Build and test with Java 25 and Gradle 9.7.1 or newer compatible Gradle 9.x:

```bash
gradle -p state-authority test
gradle -p state-authority installDist
```

Production schema management and credential delivery remain deployment concerns; credentials are never accepted through the stdio protocol or command-line arguments.
