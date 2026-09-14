package org.tavall.recovery.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.tavall.ai.agent.AIAgentExecutionRequest;
import org.tavall.ai.agent.AIAgentExecutionResult;
import org.tavall.ai.agent.AIAgentExecutionStatus;
import org.tavall.ai.agent.AIAgentProvider;
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
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class RecoveryAgentInvocationHandlerTest {
    @AfterEach
    void cleanupDependencies() {
        DependencyMap.getDependencyMap().removeDependency(RecoveryDependencies.class);
    }

    @Test
    void strandsCannotSeeTrustedReadinessOrOperatorCapabilities() {
        ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
        AIFunctionCatalog catalog = new AIFunctionCatalog(objectMapper);
        AtomicReference<Set<String>> visibleFunctions = new AtomicReference<>();
        AIAgentProvider strands = new AIAgentProvider() {
            @Override
            public String providerId() {
                return "strands";
            }

            @Override
            public AIAgentExecutionResult execute(AIAgentExecutionRequest request) {
                visibleFunctions.set(request.functionView().getFunctionDefinitions().keySet());
                return new AIAgentExecutionResult(
                        AIAgentExecutionStatus.COMPLETED,
                        objectMapper.createObjectNode().put("text", "done"),
                        0,
                        0,
                        null
                );
            }
        };
        AIAgentRuntime agentRuntime = new AIAgentRuntime(
                catalog,
                (root, definition, job) -> new AIFunctionCatalogView(root, ignored -> true),
                List.of(strands)
        );
        RecoveryControlConfiguration configuration = configuration();
        RecoveryNodeGatewayResolver gateways = new RecoveryNodeGatewayResolver(List.of(new FixedGateway()));
        DependencyMap.getDependencyMap().registerInstance(
                RecoveryDependencies.class,
                new RecoveryDependencies(configuration, gateways, agentRuntime, objectMapper)
        );
        catalog.registerInstances(List.of(
                new RecoveryObservationHandler(),
                new RecoveryReadinessHandler(),
                new RecoveryAgentInvocationHandler()
        ));

        AIAgentExecutionResult result = new RecoveryAgentInvocationHandler().invoke("inspect safely");

        assertThat(result.status()).isEqualTo(AIAgentExecutionStatus.COMPLETED);
        assertThat(visibleFunctions.get()).containsExactlyInAnyOrder(
                "fleet_status",
                "node_inspect",
                "service_inspect"
        );
        assertThat(visibleFunctions.get()).doesNotContain(
                "recovery_readiness",
                "recovery_invoke"
        );
    }

    private static RecoveryControlConfiguration configuration() {
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

    private static final class FixedGateway implements RecoveryNodeGateway {
        @Override
        public String nodeId() {
            return "east";
        }

        @Override
        public RecoveryNodeSnapshot inspectNode() {
            return new RecoveryNodeSnapshot(
                    "east",
                    "2026-09-11T02:00:00Z",
                    List.of(inspectService("api")),
                    null
            );
        }

        @Override
        public RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(String serviceId) {
            return new RecoveryNodeSnapshot.RecoveryServiceSnapshot(
                    "east",
                    serviceId,
                    "running",
                    true,
                    "healthy",
                    "2026-09-11T02:00:00Z",
                    0,
                    List.of(),
                    null
            );
        }
    }
}
