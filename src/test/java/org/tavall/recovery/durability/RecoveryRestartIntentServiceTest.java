package org.tavall.recovery.durability;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.tavall.recovery.policy.ServiceRecoveryPolicy;
import org.tavall.recovery.state.RecoveryStateAuthority;
import org.tavall.recovery.state.RecoveryStateAuthorityBuilder;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class RecoveryRestartIntentServiceTest {
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void restartIntentAndAuditSurviveAuthorityRestart() {
        String jdbcUrl = "jdbc:h2:mem:recovery_product_" + UUID.randomUUID()
                + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        Instant at = Instant.parse("2026-09-11T03:00:00Z");
        ServiceRecoveryPolicy policy = new ServiceRecoveryPolicy(
                "east",
                "api",
                "running",
                true,
                2,
                600,
                List.of()
        );

        try (RecoveryRestartIntentService service = service(jdbcUrl, true)) {
            assertThat(service.loadAttempts()).isEmpty();

            RecoveryRestartIntentService.PersistedRestartIntent persisted =
                    service.checkpointAutomaticRestartIntent(policy, at);

            assertThat(persisted.revision()).isEqualTo(1);
            assertThat(persisted.snapshot().path("restartAttempts")).hasSize(1);
            assertThat(persisted.snapshot().path("audit")).hasSize(1);
            assertThat(persisted.snapshot().path("audit").get(0).path("action").asText())
                    .isEqualTo("automatic_restart_intent");
            assertThat(persisted.snapshot().path("audit").get(0).path("nodeId").asText())
                    .isEqualTo("east");
            assertThat(persisted.snapshot().path("audit").get(0).path("serviceId").asText())
                    .isEqualTo("api");
        }

        try (RecoveryRestartIntentService reopened = service(jdbcUrl, false)) {
            assertThat(reopened.loadAttempts()).containsExactly(
                    new org.tavall.recovery.budget.RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt(
                            "east",
                            "api",
                            at.toEpochMilli()
                    )
            );
        }
    }

    @Test
    void eachIntentAdvancesCasRevisionAndAppendsAudit() {
        String jdbcUrl = "jdbc:h2:mem:recovery_product_" + UUID.randomUUID()
                + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        ServiceRecoveryPolicy policy = new ServiceRecoveryPolicy(
                "east",
                "api",
                "running",
                true,
                3,
                600,
                List.of()
        );

        try (RecoveryRestartIntentService service = service(jdbcUrl, true)) {
            RecoveryRestartIntentService.PersistedRestartIntent first =
                    service.checkpointAutomaticRestartIntent(policy, Instant.parse("2026-09-11T03:00:00Z"));
            RecoveryRestartIntentService.PersistedRestartIntent second =
                    service.checkpointAutomaticRestartIntent(policy, Instant.parse("2026-09-11T03:00:10Z"));

            assertThat(first.revision()).isEqualTo(1);
            assertThat(second.revision()).isEqualTo(2);
            assertThat(second.snapshot().path("restartAttempts")).hasSize(2);
            assertThat(second.snapshot().path("audit")).hasSize(2);
            assertThat(service.loadAttempts()).hasSize(2);
        }
    }

    private RecoveryRestartIntentService service(String jdbcUrl, boolean generateSchema) {
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
}
