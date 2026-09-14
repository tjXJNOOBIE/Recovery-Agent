package org.tavall.recovery.config;

import java.net.URI;
import java.util.List;
import java.util.Objects;

/** Immutable machine-owned Recovery control configuration. */
public record RecoveryControlConfiguration(
        Transport transport,
        List<Node> nodes
) {
    public RecoveryControlConfiguration {
        transport = Objects.requireNonNull(transport, "transport");
        nodes = List.copyOf(Objects.requireNonNull(nodes, "nodes"));
        if (nodes.isEmpty()) {
            throw new IllegalArgumentException("Recovery control configuration requires at least one node");
        }
    }

    public record Transport(String mode) {
        public Transport {
            mode = requireText(mode, "transport.mode");
        }

        public boolean isLoopbackHttp() {
            return "loopback_http".equals(mode);
        }
    }

    public record Node(
            String id,
            URI baseUri,
            String tokenEnvironmentVariable,
            List<Service> services
    ) {
        public Node {
            id = requireText(id, "node.id");
            baseUri = Objects.requireNonNull(baseUri, "baseUri");
            tokenEnvironmentVariable = requireText(tokenEnvironmentVariable, "tokenEnvironmentVariable");
            services = List.copyOf(Objects.requireNonNull(services, "services"));
            if (services.isEmpty()) {
                throw new IllegalArgumentException("Recovery node " + id + " requires at least one service");
            }
        }
    }

    public record Service(
            String id,
            boolean restartAllowed,
            int maxRestartAttempts,
            int restartBudgetWindowSeconds,
            boolean watchEnabled,
            int watchIntervalSeconds,
            List<Dependency> dependencies
    ) {
        public Service {
            id = requireText(id, "service.id");
            if (maxRestartAttempts < 0) {
                throw new IllegalArgumentException("maxRestartAttempts must be non-negative");
            }
            if (restartBudgetWindowSeconds <= 0) {
                throw new IllegalArgumentException("restartBudgetWindowSeconds must be positive");
            }
            if (watchIntervalSeconds <= 0) {
                throw new IllegalArgumentException("watchIntervalSeconds must be positive");
            }
            dependencies = List.copyOf(Objects.requireNonNull(dependencies, "dependencies"));
        }
    }

    public record Dependency(String nodeId, String serviceId) {
        public Dependency {
            nodeId = requireText(nodeId, "dependency.nodeId");
            serviceId = requireText(serviceId, "dependency.serviceId");
        }
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }
}
