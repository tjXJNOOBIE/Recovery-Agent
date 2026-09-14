package org.tavall.recovery.runtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.tavall.ai.agent.strands.StrandsAgentProviderConfiguration;
import org.tavall.ai.agent.strands.StrandsBridgeMcpClient;
import org.tavall.ai.core.annotation.AIFunction;
import org.tavall.ai.core.catalog.AIFunctionCatalog;
import org.tavall.ai.core.catalog.AIFunctionCatalogView;
import org.tavall.ai.mcp.server.AIFunctionMcpHttpServer;

import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Physical Java -> Strands stdio MCP -> Java Streamable HTTP MCP round-trip. */
class StrandsBridgeRoundTripIntegrationTest {
    private static final String NODE_ENV = "STRANDS_BRIDGE_INTEGRATION_NODE";
    private static final String ENTRYPOINT_ENV = "STRANDS_BRIDGE_INTEGRATION_ENTRYPOINT";
    private static final String REQUIRED_PROPERTY = "strands.bridge.integration.required";

    @Test
    void standaloneBridgeConnectsBackToAuthorizedRecoveryFunctionCatalog() {
        String nodeExecutable = System.getenv(NODE_ENV);
        String bridgeEntrypoint = System.getenv(ENTRYPOINT_ENV);
        boolean required = Boolean.getBoolean(REQUIRED_PROPERTY);

        if (!required) {
            Assumptions.assumeTrue(
                    hasText(nodeExecutable) && hasText(bridgeEntrypoint),
                    "Standalone Strands bridge integration paths are not configured."
            );
        }

        assertThat(nodeExecutable)
                .as("%s must be configured when bridge integration is required", NODE_ENV)
                .isNotBlank();
        assertThat(bridgeEntrypoint)
                .as("%s must be configured when bridge integration is required", ENTRYPOINT_ENV)
                .isNotBlank();

        ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
        AIFunctionCatalog catalog = new AIFunctionCatalog(objectMapper);
        catalog.registerInstances(new IntegrationFunctions());
        AIFunctionCatalogView authorizedView = new AIFunctionCatalogView(
                catalog,
                function -> "recovery_visible".equals(function.getName())
        );

        Map<String, String> bridgeEnvironment = new LinkedHashMap<>();
        copyEnvironment("HOME", bridgeEnvironment);
        copyEnvironment("PATH", bridgeEnvironment);
        copyEnvironment("TMPDIR", bridgeEnvironment);

        StrandsAgentProviderConfiguration bridgeConfiguration = StrandsAgentProviderConfiguration.node(
                Path.of(nodeExecutable),
                Path.of(bridgeEntrypoint),
                bridgeEnvironment,
                Duration.ofSeconds(20),
                ""
        );

        try (AIFunctionMcpHttpServer functionServer = AIFunctionMcpHttpServer.start(authorizedView);
             StrandsBridgeMcpClient bridgeClient = new StrandsBridgeMcpClient(bridgeConfiguration)) {
            Map<String, Object> agent = new LinkedHashMap<>();
            agent.put("id", "recovery-java-round-trip");
            agent.put("name", "Recovery Java Round Trip");
            agent.put("printer", false);

            Map<String, Object> javaFunctions = new LinkedHashMap<>();
            javaFunctions.put("url", functionServer.endpointUri().toString());
            javaFunctions.put("transport", "streamable-http");
            javaFunctions.put("prefix", "java");
            javaFunctions.put("continueOnError", false);
            javaFunctions.put("toolFilters", Map.of(
                    "allowed", List.of("recovery_visible", "recovery_hidden")
            ));

            Map<String, Object> runtimeConfig = new LinkedHashMap<>();
            runtimeConfig.put("agent", Map.copyOf(agent));
            runtimeConfig.put("mcpServers", Map.of("java-recovery-authority", Map.copyOf(javaFunctions)));

            bridgeClient.createAgent(runtimeConfig);
            bridgeClient.closeAgent("recovery-java-round-trip");
        } finally {
            authorizedView.revoke();
        }
    }

    private static void copyEnvironment(String name, Map<String, String> target) {
        String value = System.getenv(name);
        if (hasText(value)) {
            target.put(name, value);
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    static final class IntegrationFunctions {
        @AIFunction(
                name = "recovery_visible",
                description = "Visible only to the authorized Recovery integration view."
        )
        public Map<String, Object> visible() {
            return Map.of("visible", true);
        }

        @AIFunction(
                name = "recovery_hidden",
                description = "Registered in the root catalog but excluded from the authorized Recovery integration view."
        )
        public Map<String, Object> hidden() {
            return Map.of("hidden", true);
        }
    }
}
