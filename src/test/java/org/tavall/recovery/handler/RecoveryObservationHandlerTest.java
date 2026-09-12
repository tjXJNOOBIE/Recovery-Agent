package org.tavall.recovery.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.tavall.ai.agent.AIAgentRuntime;
import org.tavall.ai.core.catalog.AIFunctionCatalog;
import org.tavall.ai.core.catalog.AIFunctionCatalogView;
import org.tavall.dependency.maps.DependencyMap;
import org.tavall.recovery.config.RecoveryControlConfiguration;
import org.tavall.recovery.node.RecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeGatewayResolver;
import org.tavall.recovery.node.RecoveryNodeSnapshot;
import org.tavall.recovery.runtime.RecoveryDependencies;

import java.net.URI;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RecoveryObservationHandlerTest {
    @AfterEach
    void clearDependencies() {
        DependencyMap.getDependencyMap().removeDependency(RecoveryDependencies.class);
    }

    @Test
    void unreachableNodeDoesNotHideHealthyFleetState() {
        ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
        RecoveryNodeSnapshot.RecoveryServiceSnapshot service = new RecoveryNodeSnapshot.RecoveryServiceSnapshot(
                "east",
                "api",
                "running",
                true,
                "healthy",
                "2026-09-10T20:00:00Z",
                0,
                List.of(),
                null
        );
        RecoveryNodeGateway east = new FixedGateway(
                "east",
                new RecoveryNodeSnapshot(
                        "east",
                        "2026-09-10T20:00:00Z",
                        List.of(service),
                        null
                )
        );
        RecoveryNodeGateway west = new FailingGateway("west");
        RecoveryNodeGatewayResolver gateways = new RecoveryNodeGatewayResolver(List.of(east, west));
        RecoveryControlConfiguration configuration = new RecoveryControlConfiguration(
                new RecoveryControlConfiguration.Transport("loopback_http"),
                List.of(node("east"), node("west"))
        );
        AIFunctionCatalog catalog = new AIFunctionCatalog(objectMapper);
        AIAgentRuntime agentRuntime = new AIAgentRuntime(
                catalog,
                (root, definition, job) -> new AIFunctionCatalogView(root, ignored -> false),
                List.of()
        );
        DependencyMap.getDependencyMap().registerInstance(
                RecoveryDependencies.class,
                new RecoveryDependencies(configuration, gateways, agentRuntime, objectMapper)
        );

        RecoveryObservationHandler.FleetStatusResult result = new RecoveryObservationHandler().fleetStatus();

        assertThat(result.nodes()).extracting(RecoveryNodeSnapshot::nodeId).containsExactly("east");
        assertThat(result.unreachableNodes())
                .containsExactly(new RecoveryObservationHandler.UnreachableNodeObservation("west", "west unavailable"));
        assertThat(result.healthyServices()).isEqualTo(1);
        assertThat(result.unhealthyServices()).isZero();
    }

    private static RecoveryControlConfiguration.Node node(String id) {
        return new RecoveryControlConfiguration.Node(
                id,
                URI.create("http://127.0.0.1:7844/"),
                "RECOVERY_" + id.toUpperCase() + "_TOKEN",
                List.of(new RecoveryControlConfiguration.Service(
                        "api",
                        true,
                        1,
                        600,
                        true,
                        30,
                        List.of()
                ))
        );
    }

    private record FixedGateway(String nodeId, RecoveryNodeSnapshot snapshot) implements RecoveryNodeGateway {
        @Override
        public RecoveryNodeSnapshot inspectNode() {
            return snapshot;
        }

        @Override
        public RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(String serviceId) {
            return snapshot.services().getFirst();
        }
    }

    private record FailingGateway(String nodeId) implements RecoveryNodeGateway {
        @Override
        public RecoveryNodeSnapshot inspectNode() {
            throw new IllegalStateException(nodeId + " unavailable");
        }

        @Override
        public RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(String serviceId) {
            throw new IllegalStateException(nodeId + " unavailable");
        }
    }
}
