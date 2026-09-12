package org.tavall.recovery.recovery;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.tavall.recovery.config.RecoveryControlConfiguration;
import org.tavall.recovery.durability.RecoveryRestartIntentService;
import org.tavall.recovery.node.RecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeGatewayResolver;
import org.tavall.recovery.node.RecoveryNodeSnapshot;
import org.tavall.recovery.node.RecoveryServiceActionResult;
import org.tavall.recovery.state.RecoveryStateAuthority;
import org.tavall.recovery.state.RecoveryStateAuthorityBuilder;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class RecoveryVerifiedRestartServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void durableIntentExistsBeforeRestartEffectAndHealthyStateIsReverified() {
        String jdbcUrl = jdbcUrl();
        try (RecoveryRestartIntentService intents = intentService(jdbcUrl, true)) {
            RecordingGateway gateway = new RecordingGateway(intents, false);
            RecoveryVerifiedRestartService service = service(gateway, intents);

            RecoveryVerifiedRestartService.RestartRunResult result = service.attemptAutomaticRestart(
                    "east",
                    "api",
                    Instant.parse("2026-09-11T03:45:00Z")
            );

            assertThat(result.status()).isEqualTo(RecoveryVerifiedRestartService.RestartRunStatus.RECOVERED);
            assertThat(result.durableIntentCommitted()).isTrue();
            assertThat(result.before().healthy()).isFalse();
            assertThat(result.after().healthy()).isTrue();
            assertThat(gateway.restartCalls).isEqualTo(1);
            assertThat(gateway.observedDurableAttemptsAtRestart).isEqualTo(1);
            assertThat(intents.loadAttempts()).hasSize(1);
        }
    }

    @Test
    void unknownEffectOutcomeConsumesBudgetAndIsNeverBlindlyRetried() {
        String jdbcUrl = jdbcUrl();
        try (RecoveryRestartIntentService intents = intentService(jdbcUrl, true)) {
            RecordingGateway gateway = new RecordingGateway(intents, true);
            RecoveryVerifiedRestartService service = service(gateway, intents);

            RecoveryVerifiedRestartService.RestartRunResult first = service.attemptAutomaticRestart(
                    "east",
                    "api",
                    Instant.parse("2026-09-11T03:45:00Z")
            );
            RecoveryVerifiedRestartService.RestartRunResult second = service.attemptAutomaticRestart(
                    "east",
                    "api",
                    Instant.parse("2026-09-11T03:45:10Z")
            );

            assertThat(first.status()).isEqualTo(RecoveryVerifiedRestartService.RestartRunStatus.OUTCOME_UNKNOWN);
            assertThat(first.durableIntentCommitted()).isTrue();
            assertThat(second.status()).isEqualTo(RecoveryVerifiedRestartService.RestartRunStatus.BUDGET_EXHAUSTED);
            assertThat(second.durableIntentCommitted()).isFalse();
            assertThat(gateway.restartCalls).isEqualTo(1);
            assertThat(intents.loadAttempts()).hasSize(1);
        }
    }

    @Test
    void acceptedRestartIsPolledUntilARealisticStartupBecomesHealthy() {
        String jdbcUrl = jdbcUrl();
        try (RecoveryRestartIntentService intents = intentService(jdbcUrl, true)) {
            RecordingGateway gateway = new RecordingGateway(intents, false, 2);
            RecoveryVerifiedRestartService service = service(gateway, intents);

            RecoveryVerifiedRestartService.RestartRunResult result = service.attemptAutomaticRestart(
                    "east",
                    "api",
                    Instant.parse("2026-09-11T03:45:00Z")
            );

            assertThat(result.status()).isEqualTo(RecoveryVerifiedRestartService.RestartRunStatus.RECOVERED);
            assertThat(result.message()).contains("bounded startup polling");
            assertThat(result.after().healthy()).isTrue();
            assertThat(gateway.restartCalls).isEqualTo(1);
        }
    }

    private RecoveryVerifiedRestartService service(
            RecoveryNodeGateway gateway,
            RecoveryRestartIntentService intents
    ) {
        return new RecoveryVerifiedRestartService(
                configuration(),
                new RecoveryNodeGatewayResolver(List.of(gateway)),
                intents
        );
    }

    private RecoveryControlConfiguration configuration() {
        return new RecoveryControlConfiguration(
                new RecoveryControlConfiguration.Transport("loopback_http"),
                List.of(new RecoveryControlConfiguration.Node(
                        "east",
                        URI.create("http://127.0.0.1:7844/"),
                        "RECOVERY_EAST_TOKEN",
                        List.of(new RecoveryControlConfiguration.Service(
                                "api",
                                true,
                                1,
                                600,
                                true,
                                30,
                                List.of()
                        ))
                ))
        );
    }

    private RecoveryRestartIntentService intentService(String jdbcUrl, boolean generateSchema) {
        RecoveryStateAuthority authority = new RecoveryStateAuthorityBuilder(
                Map.of(
                        "RECOVERY_STATE_JDBC_URL", jdbcUrl,
                        "RECOVERY_STATE_DB_USERNAME", "sa",
                        "RECOVERY_STATE_DB_PASSWORD", "",
                        "RECOVERY_STATE_GENERATE_SCHEMA", Boolean.toString(generateSchema)
                ),
                objectMapper
        ).buildRequired();
        return new RecoveryRestartIntentService(authority, objectMapper);
    }

    private String jdbcUrl() {
        return "jdbc:h2:mem:recovery_verified_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
    }

    private static RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot(String state, boolean healthy, int restartCount) {
        return new RecoveryNodeSnapshot.RecoveryServiceSnapshot(
                "east",
                "api",
                state,
                healthy,
                state,
                "2026-09-11T03:45:00Z",
                restartCount,
                List.of(),
                null
        );
    }

    private static final class RecordingGateway implements RecoveryNodeGateway {
        private final RecoveryRestartIntentService intents;
        private final boolean failEffect;
        private int inspectionsUntilHealthy;
        private boolean restartIssued;
        private RecoveryNodeSnapshot.RecoveryServiceSnapshot current = snapshot("failed", false, 0);
        private int restartCalls;
        private int observedDurableAttemptsAtRestart;

        private RecordingGateway(RecoveryRestartIntentService intents, boolean failEffect) {
            this(intents, failEffect, 0);
        }

        private RecordingGateway(
                RecoveryRestartIntentService intents,
                boolean failEffect,
                int inspectionsUntilHealthy
        ) {
            this.intents = intents;
            this.failEffect = failEffect;
            this.inspectionsUntilHealthy = inspectionsUntilHealthy;
        }

        @Override
        public String nodeId() {
            return "east";
        }

        @Override
        public RecoveryNodeSnapshot inspectNode() {
            return new RecoveryNodeSnapshot(
                    "east",
                    "2026-09-11T03:45:00Z",
                    List.of(current),
                    null
            );
        }

        @Override
        public RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(String serviceId) {
            if (restartIssued && !current.healthy() && inspectionsUntilHealthy > 0 && --inspectionsUntilHealthy == 0) {
                current = snapshot("running", true, 1);
            }
            return current;
        }

        @Override
        public RecoveryServiceActionResult restartService(String serviceId) {
            restartCalls += 1;
            observedDurableAttemptsAtRestart = intents.loadAttempts().size();
            if (failEffect) {
                throw new IllegalStateException("simulated transport ambiguity");
            }
            restartIssued = true;
            current = inspectionsUntilHealthy == 0
                    ? snapshot("running", true, 1)
                    : snapshot("starting", false, 1);
            return new RecoveryServiceActionResult(true, "restart", "accepted", current);
        }
    }
}
