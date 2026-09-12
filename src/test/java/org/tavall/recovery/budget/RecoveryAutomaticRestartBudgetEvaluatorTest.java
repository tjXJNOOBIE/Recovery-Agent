package org.tavall.recovery.budget;

import org.junit.jupiter.api.Test;
import org.tavall.recovery.policy.ServiceRecoveryPolicy;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class RecoveryAutomaticRestartBudgetEvaluatorTest {
    private final RecoveryAutomaticRestartBudgetEvaluator evaluator = new RecoveryAutomaticRestartBudgetEvaluator();

    @Test
    void rollingWindowCountsOnlyCurrentTargetAttemptsInsideWindow() {
        Instant now = Instant.parse("2026-09-11T02:30:00Z");
        ServiceRecoveryPolicy policy = policy(2, 600);
        List<RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt> attempts = List.of(
                attempt("east", "api", now.minusSeconds(10)),
                attempt("east", "api", now.minusSeconds(601)),
                attempt("west", "api", now.minusSeconds(5)),
                attempt("east", "worker", now.minusSeconds(5))
        );

        RecoveryAutomaticRestartBudgetEvaluator.BudgetSnapshot snapshot = evaluator.inspect(policy, attempts, now);

        assertThat(snapshot.usedAttempts()).isEqualTo(1);
        assertThat(snapshot.remainingAttempts()).isEqualTo(1);
        assertThat(snapshot.windowMillis()).isEqualTo(600_000L);
    }

    @Test
    void exhaustedBudgetRefusesConsumptionWithoutInventingAttempt() {
        Instant now = Instant.parse("2026-09-11T02:30:00Z");
        ServiceRecoveryPolicy policy = policy(1, 600);

        RecoveryAutomaticRestartBudgetEvaluator.ConsumptionDecision decision = evaluator.evaluateConsumption(
                policy,
                List.of(attempt("east", "api", now.minusSeconds(5))),
                now
        );

        assertThat(decision.allowed()).isFalse();
        assertThat(decision.snapshot().remainingAttempts()).isZero();
        assertThat(decision.attemptToPersist()).isNull();
    }

    @Test
    void allowedConsumptionReturnsAttemptThatMustBePersistedBeforeMutation() {
        Instant now = Instant.parse("2026-09-11T02:30:00Z");
        ServiceRecoveryPolicy policy = policy(2, 600);

        RecoveryAutomaticRestartBudgetEvaluator.ConsumptionDecision decision = evaluator.evaluateConsumption(
                policy,
                List.of(),
                now
        );

        assertThat(decision.allowed()).isTrue();
        assertThat(decision.snapshot().usedAttempts()).isEqualTo(1);
        assertThat(decision.snapshot().remainingAttempts()).isEqualTo(1);
        assertThat(decision.attemptToPersist()).isEqualTo(
                new RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt(
                        "east",
                        "api",
                        now.toEpochMilli()
                )
        );
    }

    private static ServiceRecoveryPolicy policy(int maximumAttempts, int windowSeconds) {
        return new ServiceRecoveryPolicy(
                "east",
                "api",
                "running",
                true,
                maximumAttempts,
                windowSeconds,
                List.of()
        );
    }

    private static RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt attempt(
            String nodeId,
            String serviceId,
            Instant at
    ) {
        return new RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt(nodeId, serviceId, at.toEpochMilli());
    }
}
