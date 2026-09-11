package org.tavall.recovery.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.tavall.ai.agent.AIAgentRuntime;
import org.tavall.ai.core.catalog.AIFunctionCatalog;
import org.tavall.ai.core.catalog.AIFunctionCatalogView;
import org.tavall.dependency.maps.DependencyMap;
import org.tavall.recovery.config.RecoveryControlConfiguration;
import org.tavall.recovery.durability.RecoveryRestartIntentService;
import org.tavall.recovery.node.RecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeGatewayResolver;
import org.tavall.recovery.node.RecoveryNodeSnapshot;
import org.tavall.recovery.policy.ServiceRecoveryPolicy;
import org.tavall.recovery.runtime.RecoveryDependencies;
import org.tavall.recovery.state.RecoveryStateAuthority;
import org.tavall.recovery.state.RecoveryStateAuthorityBuilder;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class RecoveryReadinessHandlerTest {
    private RecoveryRestartIntentService restartIntentService;

    @AfterEach
    void clearDependencies() {
        DependencyMap.getDependencyMap().removeDependency(RecoveryDependencies.class);
        if (restartIntentService != null) {
            restartIntentService.close();
            restartIntentService = null;
        }
    }

    @Test
    void failedTargetWithHealthyDependencyIsPolicyEligibleButMutationRemainsUnavailable() {
        register(new FixedGateway(
                snapshot("api", "failed", false),
                snapshot("db", "running", true)
        ));

        RecoveryReadinessHandler.RecoveryReadinessReport report = new RecoveryReadinessHandler().inspectReadiness();
        RecoveryReadinessHandler.ServiceReadiness api = service(report, "api");

        assertThat(api.status()).isEqualTo(RecoveryReadinessHandler.ReadinessStatus.POLICY_ELIGIBLE);
        assertThat(api.restartPolicyEligible()).isTrue();
        assertThat(api.durableStateAvailable()).isFalse();
        assertThat(api.automaticRecoveryPreconditionsSatisfied()).isFalse();
        assertThat(api.mutationAvailable()).isFalse();
        assertThat(api.dependencies()).singleElement().satisfies(dependency -> {
            assertThat(dependency.reachable()).isTrue();
            assertThat(dependency.healthy()).isTrue();
        });
        assertThat(report.mutationCutoverComplete()).isFalse();
    }

    @Test
    void exhaustedDurableBudgetBlocksAutomaticRecoveryDespiteHealthyDependencies() {
        restartIntentService = durableRestartIntentService();
        ServiceRecoveryPolicy apiPolicy = ServiceRecoveryPolicy.resolve(configuration(), "east", "api");
        Instant now = Instant.now();
        restartIntentService.checkpointAutomaticRestartIntent(apiPolicy, now.minusSeconds(10));
        restartIntentService.checkpointAutomaticRestartIntent(apiPolicy, now.minusSeconds(5));
        register(
                new FixedGateway(
                        snapshot("api", "failed", false),
                        snapshot("db", "running", true)
                ),
                Optional.of(restartIntentService)
        );

        RecoveryReadinessHandler.RecoveryReadinessReport report = new RecoveryReadinessHandler().inspectReadiness();
        RecoveryReadinessHandler.ServiceReadiness api = service(report, "api");

        assertThat(report.durableStateAvailable()).isTrue();
        assertThat(api.durableStateAvailable()).isTrue();
        assertThat(api.restartPolicyEligible()).isTrue();
        assertThat(api.automaticBudget()).isNotNull();
        assertThat(api.automaticBudget().usedAttempts()).isEqualTo(2);
        assertThat(api.automaticBudget().remainingAttempts()).isZero();
        assertThat(api.automaticRecoveryPreconditionsSatisfied()).isFalse();
        assertThat(api.mutationAvailable()).isFalse();
        assertThat(api.reasons()).anyMatch(reason -> reason.contains("budget is exhausted"));
    }

    @Test
    void unhealthyDependencyBlocksOtherwiseRestartEligibleTarget() {
        register(new FixedGateway(
                snapshot("api", "failed", false),
                snapshot("db", "failed", false)
        ));

        RecoveryReadinessHandler.ServiceReadiness api = service(
                new RecoveryReadinessHandler().inspectReadiness(),
                "api"
        );

        assertThat(api.status()).isEqualTo(RecoveryReadinessHandler.ReadinessStatus.BLOCKED);
        assertThat(api.restartPolicyEligible()).isFalse();
        assertThat(api.reasons()).anyMatch(reason -> reason.contains("Dependency health blocks recovery"));
    }

    @Test
    void unknownTargetRequiresHumanRatherThanAutomaticRestart() {
        register(new FixedGateway(
                snapshot("api", "unknown", false),
                snapshot("db", "running", true)
        ));

        RecoveryReadinessHandler.ServiceReadiness api = service(
                new RecoveryReadinessHandler().inspectReadiness(),
                "api"
        );

        assertThat(api.status()).isEqualTo(RecoveryReadinessHandler.ReadinessStatus.HUMAN_REQUIRED);
        assertThat(api.restartPolicyEligible()).isFalse();
        assertThat(api.reasons()).anyMatch(reason -> reason.contains("automatic mutation is refused"));
    }

    private void register(RecoveryNodeGateway gateway) {
        register(gateway, Optional.empty());
    }

    private void register(
            RecoveryNodeGateway gateway,
            Optional<RecoveryRestartIntentService> restartIntentService
    ) {
        ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
        RecoveryControlConfiguration configuration = configuration();
        AIFunctionCatalog catalog = new AIFunctionCatalog(objectMapper);
        AIAgentRuntime agentRuntime = new AIAgentRuntime(
                catalog,
                (root, definition, job) -> new AIFunctionCatalogView(root, ignored -> false),
                List.of()
        );
        DependencyMap.getDependencyMap().registerInstance(
                RecoveryDependencies.class,
                new RecoveryDependencies(
                        configuration,
                        new RecoveryNodeGatewayResolver(List.of(gateway)),
                        agentRuntime,
                        objectMapper,
                        restartIntentService
                )
        );
    }

    private RecoveryRestartIntentService durableRestartIntentService() {
        ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
        String jdbcUrl = "jdbc:h2:mem:recovery_readiness_" + UUID.randomUUID()
                + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        RecoveryStateAuthority authority = new RecoveryStateAuthorityBuilder(
                Map.of(
                        "RECOVERY_STATE_JDBC_URL", jdbcUrl,
                        "RECOVERY_STATE_DB_USERNAME", "sa",
                        "RECOVERY_STATE_DB_PASSWORD", "",
                        "RECOVERY_STATE_GENERATE_SCHEMA", "true"
                ),
                objectMapper
        ).buildRequired();
        return new RecoveryRestartIntentService(authority, objectMapper);
    }

    private static RecoveryControlConfiguration configuration() {
        RecoveryControlConfiguration.Service database = new RecoveryControlConfiguration.Service(
                "db",
                true,
                1,
                600,
                true,
                30,
                List.of()
        );
        RecoveryControlConfiguration.Service api = new RecoveryControlConfiguration.Service(
                "api",
                true,
                2,
                600,
                true,
                30,
                List.of(new RecoveryControlConfiguration.Dependency("east", "db"))
        );
        return new RecoveryControlConfiguration(
                new RecoveryControlConfiguration.Transport("loopback_http"),
                List.of(new RecoveryControlConfiguration.Node(
                        "east",
                        URI.create("http://127.0.0.1:7844/"),
                        "RECOVERY_EAST_TOKEN",
                        List.of(database, api)
                ))
        );
    }

    private static RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot(
            String serviceId,
            String state,
            boolean healthy
    ) {
        return new RecoveryNodeSnapshot.RecoveryServiceSnapshot(
                "east",
                serviceId,
                state,
                healthy,
                state,
                "2026-09-11T02:00:00Z",
                0,
                List.of(),
                null
        );
    }

    private static RecoveryReadinessHandler.ServiceReadiness service(
            RecoveryReadinessHandler.RecoveryReadinessReport report,
            String serviceId
    ) {
        return report.services().stream()
                .filter(service -> service.serviceId().equals(serviceId))
                .findFirst()
                .orElseThrow();
    }

    private record FixedGateway(
            RecoveryNodeSnapshot.RecoveryServiceSnapshot api,
            RecoveryNodeSnapshot.RecoveryServiceSnapshot db
    ) implements RecoveryNodeGateway {
        @Override
        public String nodeId() {
            return "east";
        }

        @Override
        public RecoveryNodeSnapshot inspectNode() {
            return new RecoveryNodeSnapshot(
                    "east",
                    "2026-09-11T02:00:00Z",
                    List.of(db, api),
                    null
            );
        }

        @Override
        public RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(String serviceId) {
            return switch (serviceId) {
                case "api" -> api;
                case "db" -> db;
                default -> throw new IllegalArgumentException("Unknown test service " + serviceId);
            };
        }
    }
}
