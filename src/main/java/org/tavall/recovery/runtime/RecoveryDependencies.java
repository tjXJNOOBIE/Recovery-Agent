package org.tavall.recovery.runtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.tavall.ai.agent.AIAgentRuntime;
import org.tavall.recovery.config.RecoveryControlConfiguration;
import org.tavall.recovery.node.RecoveryNodeGatewayResolver;

import java.util.Objects;

/** Cohesive Java Recovery runtime dependency bundle exposed through Tavall DI. */
public record RecoveryDependencies(
        RecoveryControlConfiguration configuration,
        RecoveryNodeGatewayResolver gateways,
        AIAgentRuntime agentRuntime,
        ObjectMapper objectMapper
) {
    public RecoveryDependencies {
        configuration = Objects.requireNonNull(configuration, "configuration");
        gateways = Objects.requireNonNull(gateways, "gateways");
        agentRuntime = Objects.requireNonNull(agentRuntime, "agentRuntime");
        objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }
}
