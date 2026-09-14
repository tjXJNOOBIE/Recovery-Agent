package org.tavall.recovery.budget;

import org.tavall.recovery.policy.ServiceRecoveryPolicy;

import java.time.Instant;
import java.util.List;
import java.util.Objects;

/**
 * Pure rolling restart-budget evaluator.
 *
 * <p>The evaluator owns no mutable attempt history. Durable Recovery state must supply the authoritative
 * attempts so a process restart cannot reset the safety budget.</p>
 */
public final class RecoveryAutomaticRestartBudgetEvaluator {
    public BudgetSnapshot inspect(
            ServiceRecoveryPolicy policy,
            List<RestartAttempt> durableAttempts,
            Instant now
    ) {
        Objects.requireNonNull(policy, "policy");
        List<RestartAttempt> attempts = List.copyOf(Objects.requireNonNull(durableAttempts, "durableAttempts"));
        long nowMillis = Objects.requireNonNull(now, "now").toEpochMilli();
        long windowMillis = Math.multiplyExact((long) policy.restartBudgetWindowSeconds(), 1_000L);
        long cutoff = nowMillis - windowMillis;

        long usedAttempts = attempts.stream()
                .peek(RestartAttempt::validate)
                .filter(attempt -> attempt.nodeId().equals(policy.nodeId()))
                .filter(attempt -> attempt.serviceId().equals(policy.serviceId()))
                .filter(attempt -> attempt.atEpochMilli() > cutoff)
                .count();
        int used = Math.toIntExact(usedAttempts);
        int remaining = Math.max(0, policy.maxRestartAttempts() - used);
        return new BudgetSnapshot(
                policy.nodeId(),
                policy.serviceId(),
                windowMillis,
                policy.maxRestartAttempts(),
                used,
                remaining
        );
    }

    public ConsumptionDecision evaluateConsumption(
            ServiceRecoveryPolicy policy,
            List<RestartAttempt> durableAttempts,
            Instant now
    ) {
        BudgetSnapshot snapshot = inspect(policy, durableAttempts, now);
        if (snapshot.remainingAttempts() == 0) {
            return new ConsumptionDecision(false, snapshot, null);
        }
        RestartAttempt attempt = new RestartAttempt(
                policy.nodeId(),
                policy.serviceId(),
                Objects.requireNonNull(now, "now").toEpochMilli()
        );
        attempt.validate();
        return new ConsumptionDecision(
                true,
                new BudgetSnapshot(
                        snapshot.nodeId(),
                        snapshot.serviceId(),
                        snapshot.windowMillis(),
                        snapshot.maximumAttempts(),
                        snapshot.usedAttempts() + 1,
                        snapshot.remainingAttempts() - 1
                ),
                attempt
        );
    }

    public record RestartAttempt(String nodeId, String serviceId, long atEpochMilli) {
        public RestartAttempt {
            nodeId = requireText(nodeId, "nodeId");
            serviceId = requireText(serviceId, "serviceId");
            if (atEpochMilli < 0) {
                throw new IllegalArgumentException("atEpochMilli must be non-negative");
            }
        }

        private void validate() {
            // Canonical-constructor validation is retained here deliberately so malformed deserialized
            // implementations cannot silently enter the budget calculation in a later persistence slice.
            requireText(nodeId, "nodeId");
            requireText(serviceId, "serviceId");
            if (atEpochMilli < 0) {
                throw new IllegalArgumentException("atEpochMilli must be non-negative");
            }
        }
    }

    public record BudgetSnapshot(
            String nodeId,
            String serviceId,
            long windowMillis,
            int maximumAttempts,
            int usedAttempts,
            int remainingAttempts
    ) {
    }

    public record ConsumptionDecision(
            boolean allowed,
            BudgetSnapshot snapshot,
            RestartAttempt attemptToPersist
    ) {
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }
}
