package org.tavall.recovery.policy;

import org.junit.jupiter.api.Test;
import org.tavall.recovery.node.RecoveryNodeSnapshot;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RecoveryPolicyResolverTest {
    private final RecoveryPolicyResolver resolver = new RecoveryPolicyResolver();

    @Test
    void mirrorsDeterministicLegacyDecisionTable() {
        ServiceRecoveryPolicy policy = policy(true, 2);

        assertThat(resolver.resolve(snapshot("running", true), policy)).isEqualTo(RecoveryDecision.HEALTHY);
        assertThat(resolver.resolve(snapshot("failed", false), policy)).isEqualTo(RecoveryDecision.RESTART);
        assertThat(resolver.resolve(snapshot("stopped", false), policy)).isEqualTo(RecoveryDecision.RESTART);
        assertThat(resolver.resolve(snapshot("unknown", false), policy)).isEqualTo(RecoveryDecision.HUMAN_REQUIRED);
        assertThat(resolver.resolve(snapshot("starting", false), policy)).isEqualTo(RecoveryDecision.INVESTIGATE);
    }

    @Test
    void restartRequiresBothPolicyPermissionAndPositiveAttemptLimit() {
        assertThat(resolver.resolve(snapshot("failed", false), policy(false, 2)))
                .isEqualTo(RecoveryDecision.INVESTIGATE);
        assertThat(resolver.resolve(snapshot("failed", false), policy(true, 0)))
                .isEqualTo(RecoveryDecision.INVESTIGATE);
    }

    @Test
    void rejectsObservationEvaluatedUnderAnotherTargetPolicy() {
        ServiceRecoveryPolicy policy = policy(true, 2);
        RecoveryNodeSnapshot.RecoveryServiceSnapshot wrongTarget = new RecoveryNodeSnapshot.RecoveryServiceSnapshot(
                "west",
                "api",
                "failed",
                false,
                "down",
                "2026-09-11T02:00:00Z",
                0,
                List.of(),
                null
        );

        assertThatThrownBy(() -> resolver.resolve(wrongTarget, policy))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not match policy");
    }

    private static ServiceRecoveryPolicy policy(boolean restartAllowed, int maximumAttempts) {
        return new ServiceRecoveryPolicy(
                "east",
                "api",
                "running",
                restartAllowed,
                maximumAttempts,
                600,
                List.of()
        );
    }

    private static RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot(String state, boolean healthy) {
        return new RecoveryNodeSnapshot.RecoveryServiceSnapshot(
                "east",
                "api",
                state,
                healthy,
                state,
                "2026-09-11T02:00:00Z",
                0,
                List.of(),
                null
        );
    }
}
