package org.tavall.recovery.node;

import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/** Immutable runtime resolver for configured external node-agent gateways. */
public final class RecoveryNodeGatewayResolver implements AutoCloseable {
    private final List<RecoveryNodeGateway> gateways;

    public RecoveryNodeGatewayResolver(List<? extends RecoveryNodeGateway> gateways) {
        List<? extends RecoveryNodeGateway> safeGateways = Objects.requireNonNull(gateways, "gateways");
        Set<String> nodeIds = new HashSet<>();
        for (RecoveryNodeGateway gateway : safeGateways) {
            RecoveryNodeGateway safeGateway = Objects.requireNonNull(gateway, "gateway");
            if (!nodeIds.add(safeGateway.nodeId())) {
                throw new IllegalArgumentException("Duplicate Recovery node gateway for " + safeGateway.nodeId());
            }
        }
        this.gateways = List.copyOf(safeGateways);
    }

    public List<RecoveryNodeGateway> all() {
        return gateways;
    }

    public RecoveryNodeGateway require(String nodeId) {
        String safeNodeId = requireText(nodeId, "nodeId");
        for (RecoveryNodeGateway gateway : gateways) {
            if (gateway.nodeId().equals(safeNodeId)) {
                return gateway;
            }
        }
        throw new IllegalArgumentException("Unknown recovery node: " + safeNodeId);
    }

    @Override
    public void close() {
        RuntimeException failure = null;
        for (int index = gateways.size() - 1; index >= 0; index--) {
            try {
                gateways.get(index).close();
            } catch (RuntimeException exception) {
                if (failure == null) {
                    failure = exception;
                } else {
                    failure.addSuppressed(exception);
                }
            }
        }
        if (failure != null) {
            throw failure;
        }
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }
}
