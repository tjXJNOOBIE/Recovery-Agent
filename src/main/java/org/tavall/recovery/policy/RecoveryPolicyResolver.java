package org.tavall.recovery.policy;

import org.tavall.recovery.node.RecoveryNodeSnapshot;

import java.util.Locale;
import java.util.Objects;

/** Pure policy resolver. It never performs node mutations or consumes restart budget. */
public final class RecoveryPolicyResolver {
    public RecoveryDecision resolve(
            RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot,
            ServiceRecoveryPolicy policy
    ) {
        Objects.requireNonNull(snapshot, "snapshot");
        Objects.requireNonNull(policy, "policy");
        verifyTarget(snapshot, policy);

        String lifecycleState = normalized(snapshot.lifecycleState());
        if (lifecycleState.equals(normalized(policy.expectedState())) && snapshot.healthy()) {
            return RecoveryDecision.HEALTHY;
        }
        if (policy.restartAllowed()
                && policy.maxRestartAttempts() > 0
                && ("stopped".equals(lifecycleState) || "failed".equals(lifecycleState))) {
            return RecoveryDecision.RESTART;
        }
        if ("unknown".equals(lifecycleState)) {
            return RecoveryDecision.HUMAN_REQUIRED;
        }
        return RecoveryDecision.INVESTIGATE;
    }

    public boolean isHealthy(
            RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot,
            ServiceRecoveryPolicy policy
    ) {
        return resolve(snapshot, policy) == RecoveryDecision.HEALTHY;
    }

    private static void verifyTarget(
            RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot,
            ServiceRecoveryPolicy policy
    ) {
        if (!policy.nodeId().equals(snapshot.nodeId()) || !policy.serviceId().equals(snapshot.serviceId())) {
            throw new IllegalArgumentException(
                    "Recovery observation target " + snapshot.nodeId() + "/" + snapshot.serviceId()
                            + " does not match policy " + policy.nodeId() + "/" + policy.serviceId()
            );
        }
    }

    private static String normalized(String value) {
        return value == null ? "unknown" : value.trim().toLowerCase(Locale.ROOT);
    }
}
