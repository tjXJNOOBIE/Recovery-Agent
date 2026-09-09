package org.tavall.recovery.state;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.Iterator;
import java.util.Set;

public final class RecoveryStateProtocolHandler {
    private static final Set<String> COMMON_FIELDS = Set.of("id", "operation");
    private static final Set<String> COMMIT_FIELDS = Set.of("id", "operation", "expectedRevision", "snapshot");

    private final RecoveryStateAuthority authority;
    private final ObjectMapper objectMapper;

    public RecoveryStateProtocolHandler(RecoveryStateAuthority authority, ObjectMapper objectMapper) {
        this.authority = authority;
        this.objectMapper = objectMapper;
    }

    public ObjectNode handle(JsonNode request) {
        String id = null;
        try {
            if (request == null || !request.isObject()) {
                throw new IllegalArgumentException("Recovery state request must be a JSON object");
            }
            id = requireText(request, "id");
            String operation = requireText(request, "operation");
            return switch (operation) {
                case "ping" -> handlePing(id, request);
                case "load" -> handleLoad(id, request);
                case "commit" -> handleCommit(id, request);
                default -> throw new IllegalArgumentException("Unknown Recovery state operation: " + operation);
            };
        } catch (RecoveryStateStaleRevisionException exception) {
            ObjectNode response = error(id, "stale_revision", exception.getMessage());
            response.put("expectedRevision", exception.getExpectedRevision());
            response.put("actualRevision", exception.getActualRevision());
            return response;
        } catch (IllegalArgumentException exception) {
            return error(id, "invalid_request", exception.getMessage());
        } catch (RuntimeException exception) {
            return error(id, "authority_failure", exception.getMessage());
        }
    }

    private ObjectNode handlePing(String id, JsonNode request) {
        rejectUnknownFields(request, COMMON_FIELDS);
        ObjectNode response = success(id);
        response.put("available", authority.isAvailable());
        return response;
    }

    private ObjectNode handleLoad(String id, JsonNode request) {
        rejectUnknownFields(request, COMMON_FIELDS);
        RecoveryStateLoadResult result = authority.load();
        ObjectNode response = success(id);
        response.put("revision", result.revision());
        response.set("snapshot", result.snapshot());
        return response;
    }

    private ObjectNode handleCommit(String id, JsonNode request) {
        rejectUnknownFields(request, COMMIT_FIELDS);
        JsonNode expectedRevisionValue = request.get("expectedRevision");
        if (expectedRevisionValue == null || !expectedRevisionValue.isIntegralNumber() || !expectedRevisionValue.canConvertToLong()) {
            throw new IllegalArgumentException("expectedRevision must be a non-negative integer");
        }
        long expectedRevision = expectedRevisionValue.longValue();
        if (expectedRevision < 0) {
            throw new IllegalArgumentException("expectedRevision must be a non-negative integer");
        }
        JsonNode snapshot = request.get("snapshot");
        RecoveryStateLoadResult result = authority.commit(expectedRevision, snapshot);
        ObjectNode response = success(id);
        response.put("revision", result.revision());
        response.set("snapshot", result.snapshot());
        return response;
    }

    private ObjectNode success(String id) {
        ObjectNode response = objectMapper.createObjectNode();
        response.put("id", id);
        response.put("ok", true);
        return response;
    }

    private ObjectNode error(String id, String code, String message) {
        ObjectNode response = objectMapper.createObjectNode();
        if (id == null) response.putNull("id"); else response.put("id", id);
        response.put("ok", false);
        ObjectNode error = response.putObject("error");
        error.put("code", code);
        error.put("message", message == null || message.isBlank() ? code : message);
        return response;
    }

    private String requireText(JsonNode request, String field) {
        JsonNode value = request.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) {
            throw new IllegalArgumentException(field + " must be a non-blank string");
        }
        return value.textValue().trim();
    }

    private void rejectUnknownFields(JsonNode request, Set<String> allowed) {
        Iterator<String> names = request.fieldNames();
        while (names.hasNext()) {
            String name = names.next();
            if (!allowed.contains(name)) {
                throw new IllegalArgumentException("Unknown Recovery state request field: " + name);
            }
        }
    }
}
