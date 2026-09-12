package org.tavall.recovery.incident;

import java.util.Objects;

/** Durable current incident projection returned by the Recovery control surface. */
public record RecoveryIncidentRecord(
        String id,
        String nodeId,
        String serviceId,
        String status,
        String summary,
        String openedAt,
        String updatedAt
) {
    public RecoveryIncidentRecord {
        id = requireText(id, "id");
        nodeId = requireText(nodeId, "nodeId");
        serviceId = requireText(serviceId, "serviceId");
        status = requireText(status, "status");
        summary = requireText(summary, "summary");
        openedAt = requireText(openedAt, "openedAt");
        updatedAt = requireText(updatedAt, "updatedAt");
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }
}
