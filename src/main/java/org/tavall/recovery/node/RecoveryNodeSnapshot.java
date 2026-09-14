package org.tavall.recovery.node;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record RecoveryNodeSnapshot(
        String nodeId,
        String observedAt,
        List<RecoveryServiceSnapshot> services,
        JsonNode resources
) {
    public RecoveryNodeSnapshot {
        services = services == null ? List.of() : List.copyOf(services);
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RecoveryServiceSnapshot(
            String nodeId,
            String serviceId,
            String lifecycleState,
            boolean healthy,
            String detail,
            String observedAt,
            int restartCount,
            List<JsonNode> healthChecks,
            JsonNode deployment
    ) {
        public RecoveryServiceSnapshot {
            healthChecks = healthChecks == null ? List.of() : List.copyOf(healthChecks);
        }
    }
}
