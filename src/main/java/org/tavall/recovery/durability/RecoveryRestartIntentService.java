package org.tavall.recovery.durability;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.tavall.recovery.budget.RecoveryAutomaticRestartBudgetEvaluator;
import org.tavall.recovery.policy.ServiceRecoveryPolicy;
import org.tavall.recovery.state.RecoveryStateAuthority;
import org.tavall.recovery.state.RecoveryStateLoadResult;
import org.tavall.recovery.state.RecoveryStateStaleRevisionException;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.function.UnaryOperator;

/**
 * In-process Java durability boundary for automatic restart intent.
 *
 * <p>Budget evaluation, attempt consumption, and the audit entry are committed atomically under the state
 * authority's CAS revision before a node effect may execute. CAS conflicts force a fresh load and budget
 * re-evaluation, so concurrent Recovery processes cannot oversubscribe the rolling restart budget.</p>
 */
public final class RecoveryRestartIntentService implements AutoCloseable {
    private static final int MAX_RESERVATION_RETRIES = 8;

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

    /** Applies one optimistic-concurrency-protected durable state transition. */
    public JsonNode updateSnapshot(UnaryOperator<ObjectNode> transition) {
        Objects.requireNonNull(transition, "transition");
        RecoveryStateStaleRevisionException lastConflict = null;
        for (int retry = 0; retry < MAX_RESERVATION_RETRIES; retry++) {
            RecoveryStateLoadResult loaded = authority.load();
            ObjectNode candidate = requireObject(loaded.snapshot()).deepCopy();
            ObjectNode transitioned = Objects.requireNonNull(transition.apply(candidate), "transition result");
            try {
                return authority.commit(loaded.revision(), transitioned).snapshot();
            } catch (RecoveryStateStaleRevisionException conflict) {
                lastConflict = conflict;
            }
        }
        throw new IllegalStateException(
                "Recovery durable state transition could not acquire a CAS revision after "
                        + MAX_RESERVATION_RETRIES + " attempts",
                lastConflict
        );
    }

    /**
     * Reserve one automatic restart attempt under the durable rolling budget.
     *
     * <p>An allowed result is already durable and therefore safe to use as the write-ahead intent for a later
     * node mutation. A denied result performs no write.</p>
     */
    public RestartIntentReservation reserveAutomaticRestartIntent(
            ServiceRecoveryPolicy policy,
            Instant at,
            RecoveryAutomaticRestartBudgetEvaluator budgetEvaluator
    ) {
        Objects.requireNonNull(policy, "policy");
        Instant safeAt = Objects.requireNonNull(at, "at");
        RecoveryAutomaticRestartBudgetEvaluator evaluator = Objects.requireNonNull(
                budgetEvaluator,
                "budgetEvaluator"
        );

        RecoveryStateStaleRevisionException lastConflict = null;
        for (int retry = 0; retry < MAX_RESERVATION_RETRIES; retry++) {
            RecoveryStateLoadResult loaded = authority.load();
            List<RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt> attempts =
                    parseAttempts(loaded.snapshot().path("restartAttempts"));
            RecoveryAutomaticRestartBudgetEvaluator.ConsumptionDecision decision =
                    evaluator.evaluateConsumption(policy, attempts, safeAt);
            if (!decision.allowed()) {
                return new RestartIntentReservation(
                        false,
                        loaded.revision(),
                        decision.snapshot(),
                        null,
                        loaded.snapshot().deepCopy()
                );
            }

            ObjectNode candidate = requireObject(loaded.snapshot()).deepCopy();
            RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt attempt =
                    Objects.requireNonNull(decision.attemptToPersist(), "attemptToPersist");
            appendRestartAttempt(candidate, attempt);
            appendAudit(candidate, policy, safeAt);

            try {
                RecoveryStateLoadResult committed = authority.commit(loaded.revision(), candidate);
                return new RestartIntentReservation(
                        true,
                        committed.revision(),
                        decision.snapshot(),
                        attempt,
                        committed.snapshot().deepCopy()
                );
            } catch (RecoveryStateStaleRevisionException conflict) {
                lastConflict = conflict;
            }
        }

        throw new IllegalStateException(
                "Recovery restart intent reservation could not acquire a durable CAS revision after "
                        + MAX_RESERVATION_RETRIES + " attempts",
                lastConflict
        );
    }

    /**
     * Compatibility helper for callers that already proved a reservation should be available.
     *
     * <p>Unlike the earlier implementation this cannot overrun the configured rolling budget.</p>
     */
    public PersistedRestartIntent checkpointAutomaticRestartIntent(
            ServiceRecoveryPolicy policy,
            Instant at
    ) {
        RestartIntentReservation reservation = reserveAutomaticRestartIntent(
                policy,
                at,
                new RecoveryAutomaticRestartBudgetEvaluator()
        );
        if (!reservation.allowed()) {
            throw new IllegalStateException(
                    "Automatic restart budget exhausted for " + policy.nodeId() + "/" + policy.serviceId()
            );
        }
        return new PersistedRestartIntent(
                reservation.revision(),
                Objects.requireNonNull(reservation.attempt(), "attempt"),
                reservation.snapshot()
        );
    }

    @Override
    public void close() {
        authority.close();
    }

    private void appendRestartAttempt(
            ObjectNode candidate,
            RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt attempt
    ) {
        ObjectNode attemptJson = candidate.withArray("restartAttempts").addObject();
        attemptJson.put("nodeId", attempt.nodeId());
        attemptJson.put("serviceId", attempt.serviceId());
        attemptJson.put("atMs", attempt.atEpochMilli());
    }

    private void appendAudit(ObjectNode candidate, ServiceRecoveryPolicy policy, Instant at) {
        ObjectNode audit = candidate.withArray("audit").addObject();
        audit.put("id", UUID.randomUUID().toString());
        audit.put("at", at.toString());
        audit.put("actor", "recovery-agent");
        audit.put("action", "automatic_restart_intent");
        audit.put("summary", "Persisted automatic restart intent before executing the node mutation");
        audit.put("nodeId", policy.nodeId());
        audit.put("serviceId", policy.serviceId());
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

    public record RestartIntentReservation(
            boolean allowed,
            long revision,
            RecoveryAutomaticRestartBudgetEvaluator.BudgetSnapshot budget,
            RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt attempt,
            JsonNode snapshot
    ) {
        public RestartIntentReservation {
            if (revision < 0) {
                throw new IllegalArgumentException("revision must be non-negative");
            }
            budget = Objects.requireNonNull(budget, "budget");
            if (allowed && attempt == null) {
                throw new IllegalArgumentException("allowed restart reservation requires an attempt");
            }
            if (!allowed && attempt != null) {
                throw new IllegalArgumentException("denied restart reservation must not contain an attempt");
            }
            snapshot = Objects.requireNonNull(snapshot, "snapshot").deepCopy();
        }
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
