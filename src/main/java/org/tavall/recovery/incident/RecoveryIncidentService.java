package org.tavall.recovery.incident;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.tavall.recovery.durability.RecoveryRestartIntentService;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Owns durable Recovery incident transitions and append-only audit entries. */
public final class RecoveryIncidentService {
    private final RecoveryRestartIntentService durableState;
    private final ObjectMapper objectMapper;

    public RecoveryIncidentService(
            RecoveryRestartIntentService durableState,
            ObjectMapper objectMapper
    ) {
        this.durableState = Objects.requireNonNull(durableState, "durableState");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public RecoveryIncidentRecord transition(
            String nodeId,
            String serviceId,
            String status,
            String summary,
            Instant at
    ) {
        String safeNodeId = requireText(nodeId, "nodeId");
        String safeServiceId = requireText(serviceId, "serviceId");
        String safeStatus = requireText(status, "status");
        String safeSummary = requireText(summary, "summary");
        Instant safeAt = Objects.requireNonNull(at, "at");
        String incidentId = safeNodeId + "/" + safeServiceId;
        JsonNode snapshot = durableState.updateSnapshot(candidate -> {
            ArrayNode incidents = candidate.withArray("incidents");
            ObjectNode incident = null;
            int incidentIndex = -1;
            for (int index = 0; index < incidents.size(); index++) {
                JsonNode value = incidents.get(index);
                if (incidentId.equals(value.path("id").asText())) {
                    incident = (ObjectNode) value;
                    incidentIndex = index;
                    break;
                }
            }
            String openedAt = incident == null ? safeAt.toString() : incident.path("openedAt").asText(safeAt.toString());
            ObjectNode replacement = objectMapper.createObjectNode();
            replacement.put("id", incidentId);
            replacement.put("nodeId", safeNodeId);
            replacement.put("serviceId", safeServiceId);
            replacement.put("status", safeStatus);
            replacement.put("summary", safeSummary);
            replacement.put("openedAt", openedAt);
            replacement.put("updatedAt", safeAt.toString());
            if (incident == null) {
                incidents.add(replacement);
            } else {
                incidents.set(incidentIndex, replacement);
            }
            ObjectNode audit = candidate.withArray("audit").addObject();
            audit.put("id", UUID.randomUUID().toString());
            audit.put("at", safeAt.toString());
            audit.put("actor", "recovery-agent");
            audit.put("action", "incident_transition");
            audit.put("summary", safeSummary);
            audit.put("nodeId", safeNodeId);
            audit.put("serviceId", safeServiceId);
            audit.put("status", safeStatus);
            return candidate;
        });
        return readIncident(snapshot, incidentId);
    }

    private RecoveryIncidentRecord readIncident(JsonNode snapshot, String incidentId) {
        for (JsonNode value : ((ObjectNode) snapshot).withArray("incidents")) {
            if (incidentId.equals(value.path("id").asText())) {
                return new RecoveryIncidentRecord(
                        value.path("id").asText(),
                        value.path("nodeId").asText(),
                        value.path("serviceId").asText(),
                        value.path("status").asText(),
                        value.path("summary").asText(),
                        value.path("openedAt").asText(),
                        value.path("updatedAt").asText()
                );
            }
        }
        throw new IllegalStateException("Durable Recovery incident transition was not persisted: " + incidentId);
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }
}
