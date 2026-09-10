package org.tavall.recovery.agent;

import org.tavall.ai.agent.strands.StrandsAgentProviderConfiguration;

import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Resolves the narrow environment Java is allowed to pass to the standalone Strands service. */
public final class RecoveryStrandsConfigurationResolver {
    public static final String NODE_EXECUTABLE_ENV = "RECOVERY_AGENT_STRANDS_NODE";
    public static final String BRIDGE_ENTRYPOINT_ENV = "RECOVERY_AGENT_STRANDS_ENTRYPOINT";
    public static final String MODEL_ID_ENV = "RECOVERY_AGENT_MODEL_ID";

    private static final Set<String> ALLOWED_STRANDS_ENVIRONMENT = Set.of(
            "PATH",
            "HOME",
            "TMPDIR",
            "TMP",
            "TEMP",
            "NODE_EXTRA_CA_CERTS",
            "SSL_CERT_FILE",
            "AWS_REGION",
            "AWS_DEFAULT_REGION",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "AWS_PROFILE",
            "AWS_SDK_LOAD_CONFIG",
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY"
    );

    private final Map<String, String> environment;

    public RecoveryStrandsConfigurationResolver(Map<String, String> environment) {
        this.environment = Map.copyOf(Objects.requireNonNull(environment, "environment"));
    }

    public StrandsAgentProviderConfiguration resolve() {
        Path nodeExecutable = Path.of(requiredEnvironment(NODE_EXECUTABLE_ENV));
        Path bridgeEntrypoint = Path.of(requiredEnvironment(BRIDGE_ENTRYPOINT_ENV));
        Map<String, String> strandsEnvironment = new LinkedHashMap<>();
        for (String name : ALLOWED_STRANDS_ENVIRONMENT) {
            String value = environment.get(name);
            if (value != null && !value.isBlank()) {
                strandsEnvironment.put(name, value);
            }
        }

        String modelId = optionalEnvironment(MODEL_ID_ENV);
        return StrandsAgentProviderConfiguration.node(
                nodeExecutable,
                bridgeEntrypoint,
                strandsEnvironment,
                Duration.ofMinutes(5),
                modelId == null ? "" : modelId
        );
    }

    private String requiredEnvironment(String name) {
        String value = optionalEnvironment(name);
        if (value == null) {
            throw new IllegalStateException(name + " must point to the standalone Strands runtime installation");
        }
        return value;
    }

    private String optionalEnvironment(String name) {
        String value = environment.get(name);
        return value == null || value.isBlank() ? null : value.trim();
    }
}
