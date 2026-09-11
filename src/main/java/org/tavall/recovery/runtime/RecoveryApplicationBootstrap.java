package org.tavall.recovery.runtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.tavall.ai.agent.AIAgentRuntime;
import org.tavall.ai.agent.strands.StrandsAgentProvider;
import org.tavall.ai.agent.strands.StrandsAgentProviderConfiguration;
import org.tavall.ai.core.catalog.AIFunctionCatalog;
import org.tavall.ai.core.catalog.AIFunctionCatalogView;
import org.tavall.ai.mcp.server.AIFunctionMcpHttpServer;
import org.tavall.dependency.maps.DependencyMap;
import org.tavall.recovery.agent.RecoveryStrandsConfigurationResolver;
import org.tavall.recovery.config.RecoveryControlConfiguration;
import org.tavall.recovery.config.RecoveryControlConfigurationReader;
import org.tavall.recovery.handler.RecoveryAgentInvocationHandler;
import org.tavall.recovery.handler.RecoveryObservationHandler;
import org.tavall.recovery.handler.RecoveryReadinessHandler;
import org.tavall.recovery.node.HttpRecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeGatewayResolver;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Java composition root for the Recovery Agent control process. */
public final class RecoveryApplicationBootstrap {
    private static final Set<String> STRANDS_FUNCTIONS = Set.of(
            "fleet_status",
            "node_inspect",
            "service_inspect"
    );
    private static final Set<String> OPERATOR_FUNCTIONS = Set.of(
            "fleet_status",
            "node_inspect",
            "service_inspect",
            "recovery_readiness",
            "recovery_invoke"
    );

    private RecoveryApplicationBootstrap() {
    }

    public static RecoveryApplicationRuntime start(
            Path configurationPath,
            Map<String, String> environment
    ) {
        Map<String, String> safeEnvironment = Map.copyOf(Objects.requireNonNull(environment, "environment"));
        ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
        RecoveryControlConfiguration configuration = new RecoveryControlConfigurationReader(objectMapper)
                .read(Objects.requireNonNull(configurationPath, "configurationPath"));
        if (!configuration.transport().isLoopbackHttp()) {
            throw new IllegalStateException(
                    "The Java Recovery migration currently supports loopback_http control nodes only; outbound_tls remains on the legacy runtime until its authenticated session transport is ported."
            );
        }

        List<RecoveryNodeGateway> gateways = buildGateways(configuration, safeEnvironment, objectMapper);
        RecoveryNodeGatewayResolver gatewayResolver = new RecoveryNodeGatewayResolver(gateways);
        StrandsAgentProviderConfiguration strandsConfiguration = new RecoveryStrandsConfigurationResolver(safeEnvironment)
                .resolve();
        StrandsAgentProvider strandsProvider = new StrandsAgentProvider(strandsConfiguration);
        AIFunctionCatalog catalog = new AIFunctionCatalog(objectMapper);
        AIAgentRuntime agentRuntime = new AIAgentRuntime(
                catalog,
                (root, definition, job) -> new AIFunctionCatalogView(
                        root,
                        function -> STRANDS_FUNCTIONS.contains(function.getName())
                ),
                List.of(strandsProvider)
        );
        RecoveryDependencies dependencies = new RecoveryDependencies(
                configuration,
                gatewayResolver,
                agentRuntime,
                objectMapper
        );
        DependencyMap.getDependencyMap().registerInstance(RecoveryDependencies.class, dependencies);

        AIFunctionCatalogView operatorView = null;
        AIFunctionMcpHttpServer operatorServer = null;
        try {
            catalog.registerInstances(List.of(
                    new RecoveryObservationHandler(),
                    new RecoveryReadinessHandler(),
                    new RecoveryAgentInvocationHandler()
            ));
            operatorView = new AIFunctionCatalogView(
                    catalog,
                    function -> OPERATOR_FUNCTIONS.contains(function.getName())
            );
            operatorServer = AIFunctionMcpHttpServer.start(operatorView);
            return new RecoveryApplicationRuntime(
                    operatorServer,
                    operatorView,
                    strandsProvider,
                    gateways
            );
        } catch (RuntimeException exception) {
            if (operatorView != null) {
                operatorView.revoke();
            }
            if (operatorServer != null) {
                try {
                    operatorServer.close();
                } catch (RuntimeException closeFailure) {
                    exception.addSuppressed(closeFailure);
                }
            }
            DependencyMap.getDependencyMap().removeDependency(RecoveryDependencies.class);
            try {
                strandsProvider.close();
            } catch (RuntimeException closeFailure) {
                exception.addSuppressed(closeFailure);
            }
            closeGateways(gateways, exception);
            throw exception;
        }
    }

    private static List<RecoveryNodeGateway> buildGateways(
            RecoveryControlConfiguration configuration,
            Map<String, String> environment,
            ObjectMapper objectMapper
    ) {
        List<RecoveryNodeGateway> gateways = new ArrayList<>();
        for (RecoveryControlConfiguration.Node node : configuration.nodes()) {
            String token = environment.get(node.tokenEnvironmentVariable());
            if (token == null || token.isBlank()) {
                throw new IllegalStateException(
                        "Environment variable " + node.tokenEnvironmentVariable()
                                + " must contain the configured Recovery node bearer token"
                );
            }
            gateways.add(new HttpRecoveryNodeGateway(
                    node.id(),
                    node.baseUri(),
                    token.trim(),
                    objectMapper
            ));
        }
        return List.copyOf(gateways);
    }

    private static void closeGateways(List<RecoveryNodeGateway> gateways, RuntimeException failure) {
        for (int index = gateways.size() - 1; index >= 0; index--) {
            try {
                gateways.get(index).close();
            } catch (RuntimeException closeFailure) {
                failure.addSuppressed(closeFailure);
            }
        }
    }
}
