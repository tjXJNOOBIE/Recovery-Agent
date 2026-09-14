package org.tavall.recovery.handler;

import org.tavall.ai.agent.AIAgentDefinition;
import org.tavall.ai.agent.AIAgentExecutionBudget;
import org.tavall.ai.agent.AIAgentExecutionResult;
import org.tavall.ai.agent.AIAgentJob;
import org.tavall.ai.core.annotation.AIFunction;
import org.tavall.ai.core.annotation.AIParam;
import org.tavall.dependency.DependencyAccess;
import org.tavall.recovery.agent.RecoveryAgentPrompt;
import org.tavall.recovery.runtime.RecoveryDependencies;

import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Invokes Strands through Tavall's provider-neutral Java agent runtime. */
public final class RecoveryAgentInvocationHandler implements DependencyAccess<RecoveryDependencies> {
    private static final Set<String> AGENT_FUNCTIONS = Set.of(
            "fleet_status",
            "node_inspect",
            "service_inspect"
    );

    @AIFunction(
            name = "recovery_invoke",
            description = "Run Recovery Agent reasoning over the currently authorized Java recovery capabilities."
    )
    public AIAgentExecutionResult invoke(
            @AIParam(name = "request", description = "Authenticated Recovery control request") String request
    ) {
        RecoveryDependencies dependencies = getInstance();
        AIAgentDefinition definition = new AIAgentDefinition(
                "recovery-agent",
                "Recovery infrastructure investigator",
                RecoveryAgentPrompt.SYSTEM_PROMPT,
                "strands",
                AGENT_FUNCTIONS
        );
        AIAgentJob job = new AIAgentJob(
                UUID.randomUUID().toString(),
                requireText(request, "request"),
                0,
                Map.of("source", "recovery-java-control")
        );
        AIAgentExecutionBudget budget = new AIAgentExecutionBudget(
                Duration.ofMinutes(5),
                20,
                0
        );
        return dependencies.agentRuntime().execute(definition, job, budget);
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }
}
