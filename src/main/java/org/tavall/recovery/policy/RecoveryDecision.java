package org.tavall.recovery.policy;

/** Deterministic pre-mutation decision derived from observed service state and machine policy. */
public enum RecoveryDecision {
    HEALTHY,
    RESTART,
    INVESTIGATE,
    HUMAN_REQUIRED
}
