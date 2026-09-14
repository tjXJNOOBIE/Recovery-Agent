package org.tavall.recovery.policy;

import org.tavall.recovery.config.RecoveryControlConfiguration;

import java.util.List;
import java.util.Objects;

/** Immutable deterministic recovery policy resolved from machine-owned control configuration. */
public record ServiceRecoveryPolicy(
        String nodeId,
        String serviceId,
        String expectedState,
        boolean restartAllowed,
        int maxRestartAttempts,
        int restartBudgetWindowSeconds,
        List<RecoveryControlConfiguration.Dependency> dependencies
) {
    public ServiceRecoveryPolicy {
        nodeId = requireText(nodeId, "nodeId");
        serviceId = requireText(serviceId, "serviceId");
        expectedState = requireText(expectedState, "expectedState");
        if (maxRestartAttempts < 0) {
            throw new IllegalArgumentException("maxRestartAttempts must be non-negative");
        }
        if (restartBudgetWindowSeconds <= 0) {
            throw new IllegalArgumentException("restartBudgetWindowSeconds must be positive");
        }
        dependencies = List.copyOf(Objects.requireNonNull(dependencies, "dependencies"));
    }

    public static ServiceRecoveryPolicy resolve(
            RecoveryControlConfiguration configuration,
            String nodeId,
            String serviceId
    ) {
        Objects.requireNonNull(configuration, "configuration");
        String safeNodeId = requireText(nodeId, "nodeId");
        String safeServiceId = requireText(serviceId, "serviceId");
        for (RecoveryControlConfiguration.Node node : configuration.nodes()) {
            if (!node.id().equals(safeNodeId)) {
                continue;
            }
            for (RecoveryControlConfiguration.Service service : node.services()) {
                if (service.id().equals(safeServiceId)) {
                    return from(node, service);
                }
            }
        }
        throw new IllegalArgumentException("No recovery policy configured for " + safeNodeId + "/" + safeServiceId);
    }

    public static List<ServiceRecoveryPolicy> all(RecoveryControlConfiguration configuration) {
        Objects.requireNonNull(configuration, "configuration");
        return configuration.nodes().stream()
                .flatMap(node -> node.services().stream().map(service -> from(node, service)))
                .toList();
    }

    private static ServiceRecoveryPolicy from(
            RecoveryControlConfiguration.Node node,
            RecoveryControlConfiguration.Service service
    ) {
        return new ServiceRecoveryPolicy(
                node.id(),
                service.id(),
                "running",
                service.restartAllowed(),
                service.maxRestartAttempts(),
                service.restartBudgetWindowSeconds(),
                service.dependencies()
        );
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }
}
