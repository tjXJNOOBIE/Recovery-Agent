package org.tavall.recovery.node;

import java.util.Objects;

/** Typed response from a node-agent service mutation. */
public record RecoveryServiceActionResult(
        boolean accepted,
        String action,
        String message,
        RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot
) {
    public RecoveryServiceActionResult {
        action = requireText(action, "action");
        message = Objects.requireNonNullElse(message, "");
        snapshot = Objects.requireNonNull(snapshot, "snapshot");
        if (!"restart".equals(action)) {
            throw new IllegalArgumentException("Unsupported Recovery service action: " + action);
        }
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }
}
