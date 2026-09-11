package org.tavall.recovery.durability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.tavall.recovery.budget.RecoveryAutomaticRestartBudgetEvaluator;
import org.tavall.recovery.policy.ServiceRecoveryPolicy;
import org.tavall.recovery.state.RecoveryStateAuthority;
import org.tavall.recovery.state.RecoveryStateLoadResult;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * In-process Java durability boundary for automatic restart intent.
 *
 * <p>Attempt consumption and its audit entry are committed atomically under the state authority's CAS revision
 * before a node effect may be executed. This service deliberately performs no node mutation.</p>
 */
public final class RecoveryRestartIntentService implements AutoCloseable {
    private final RecoveryStateAuthority authority;
    private final ObjectMapper objectMapper;

    public RecoveryRestartIntentService(RecoveryStateAuthority authority, ObjectMapper objectMapper) {
        this.authority = Objects.requireNonNull(authority, "authority");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public boolean isAvailable() {
        return authority.isAvailable();
    }

    public List<RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt> loadAttempts() {
        RecoveryStateLoadResult loaded = authority.load();
        return parseAttempts(loaded.snapshot().path("restartAttempts"));
    }

    public PersistedRestartIntent checkpointAutomaticRestartIntent(
            ServiceRecoveryPolicy policy,
            Instant at
    ) {
        Objects.requireNonNull(policy, "policy");
        Instant safeAt = Objects.requireNonNull(at, "at");
        RecoveryStateLoadResult loaded = authority.load();
        ObjectNode candidate = requireObject(loaded.snapshot()).deepCopy();

        RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt attempt =
                new RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt(
                        policy.nodeId(),
                        policy.serviceId(),
                        safeAt.toEpochMilli()
                );
        ObjectNode attemptJson = candidate.withArray("restartAttempts").addObject();
        attemptJson.put("nodeId", attempt.nodeId());
        attemptJson.put("serviceId", attempt.serviceId());
        attemptJson.put("atMs", attempt.atEpochMilli());

        ObjectNode audit = candidate.withArray("audit").addObject();
        audit.put("id", UUID.randomUUID().toString());
        audit.put("at", safeAt.toString());
        audit.put("actor", "recovery-agent");
        audit.put("action", "automatic_restart_intent");
        audit.put(
                "summary",
                "Persisted automatic restart intent before executing the node mutation"
        );
        audit.put("nodeId", policy.nodeId());
        audit.put("serviceId", policy.serviceId());

        RecoveryStateLoadResult committed = authority.commit(loaded.revision(), candidate);
        return new PersistedRestartIntent(
                committed.revision(),
                attempt,
                committed.snapshot().deepCopy()
        );
    }

    @Override
    public void close() {
        authority.close();
    }

    private List<RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt> parseAttempts(JsonNode attemptsNode) {
        if (!(attemptsNode instanceof ArrayNode attempts)) {
            throw new IllegalStateException("Recovery durable restartAttempts must be an array");
        }
        List<RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt> result = new ArrayList<>();
        for (int index = 0; index < attempts.size(); index++) {
            JsonNode value = attempts.get(index);
            if (value == null || !value.isObject()) {
                throw new IllegalStateException("Recovery durable restartAttempts[" + index + "] must be an object");
            }
            String nodeId = requiredText(value, "nodeId", index);
            String serviceId = requiredText(value, "serviceId", index);
            JsonNode at = value.get("atMs");
            if (at == null || !at.isIntegralNumber() || !at.canConvertToLong() || at.longValue() < 0) {
                throw new IllegalStateException(
                        "Recovery durable restartAttempts[" + index + "].atMs must be a non-negative integer"
                );
            }
            result.add(new RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt(
                    nodeId,
                    serviceId,
                    at.longValue()
            ));
        }
        return List.copyOf(result);
    }

    private ObjectNode requireObject(JsonNode snapshot) {
        if (snapshot instanceof ObjectNode object) {
            return object;
        }
        throw new IllegalStateException("Recovery durable snapshot must be an object");
    }

    private String requiredText(JsonNode value, String field, int index) {
        JsonNode node = value.get(field);
        if (node == null || !node.isTextual() || node.textValue().isBlank()) {
            throw new IllegalStateException(
                    "Recovery durable restartAttempts[" + index + "]." + field + " must be non-blank text"
            );
        }
        return node.textValue().trim();
    }

    public record PersistedRestartIntent(
            long revision,
            RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt attempt,
            JsonNode snapshot
    ) {
        public PersistedRestartIntent {
            if (revision <= 0) {
                throw new IllegalArgumentException("revision must be positive after persistence");
            }
            attempt = Objects.requireNonNull(attempt, "attempt");
            snapshot = Objects.requireNonNull(snapshot, "snapshot").deepCopy();
        }
    }
}
