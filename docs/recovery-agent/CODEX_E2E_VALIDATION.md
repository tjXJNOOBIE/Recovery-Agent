# Current Codex E2E validation

Validated on 2026-09-11 against Recovery PR #18 head `f5c23f0a16cff2c35cb0b2ff60ea1772316b3642`.

- `npm run check`: passed, 160 tests; 154 passed and 6 TLS certificate tests skipped because `RECOVERY_TLS_TEST_CERT_DIR` was not configured.
- Java `clean check`: passed, including the canonical `architectureTest` and state-authority tests.
- Java `installDist`: passed; the packaged Recovery launcher and bundled state-authority distribution were created.
- Physical bridge test: passed one non-skipped `StrandsBridgeRoundTripIntegrationTest` test with Node 22, the installed Strands bridge MCP entrypoint, a Java Streamable HTTP Function Catalog, and a revoked authorized view on teardown.

The model-facing Recovery view remains observation/proposal bounded. Approval and restart effects remain deterministic Java authority boundaries. No production system was touched by this validation; no production operation record was required.

Remaining external gates are authorized real-model/provider validation, a supported external host/Inspector session, and any broader production adapter acceptance that is actually in product scope.
