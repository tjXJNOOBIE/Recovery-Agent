package org.tavall.recovery.handler;

import org.tavall.ai.core.annotation.AIFunction;
import org.tavall.ai.core.annotation.AIParam;
import org.tavall.dependency.DependencyAccess;
import org.tavall.recovery.incident.RecoveryIncidentRecord;
import org.tavall.recovery.incident.RecoveryIncidentService;
import org.tavall.recovery.recovery.RecoveryVerifiedRestartService;
import org.tavall.recovery.runtime.RecoveryDependencies;

import java.time.Instant;
import java.util.Objects;

/** Trusted operator recovery workflow; never published to the Strands/model view. */
public final class RecoveryOperatorHandler implements DependencyAccess<RecoveryDependencies> {
    @AIFunction(
            name = "recovery_recover",
            description = "Apply deterministic policy to one configured service and execute and verify at most one bounded Java recovery action."
    )
    public RecoveryWorkflowResult recover(
            @AIParam(name = "nodeId", description = "Configured Recovery node ID") String nodeId,
            @AIParam(name = "serviceId", description = "Configured service ID") String serviceId
    ) {
        String safeNodeId = requireText(nodeId, "nodeId");
        String safeServiceId = requireText(serviceId, "serviceId");
        RecoveryDependencies dependencies = getInstance();
        RecoveryIncidentService incidents = dependencies.incidentService()
                .orElseThrow(() -> new IllegalStateException("Durable Recovery state is required for recovery mutation"));
        RecoveryVerifiedRestartService restart = dependencies.restartService()
                .orElseThrow(() -> new IllegalStateException("Recovery restart mutation is not configured"));
        Instant startedAt = Instant.now();
        RecoveryIncidentRecord opened = incidents.transition(
                safeNodeId,
                safeServiceId,
                "RECOVERING",
                "Recovery investigation started from authenticated operator control",
                startedAt
        );
        RecoveryVerifiedRestartService.RestartRunResult result = restart.attemptAutomaticRestart(
                safeNodeId,
                safeServiceId,
                Instant.now()
        );
        String status = incidentStatus(result.status());
        RecoveryIncidentRecord completed = incidents.transition(
                safeNodeId,
                safeServiceId,
                status,
                result.message(),
                Instant.now()
        );
        return new RecoveryWorkflowResult(
                result.status().name(),
                "Deterministic Java policy selected a bounded recovery attempt after the operator request; Strands reasoning remains available through recovery_invoke and never owns the effect.",
                result,
                opened,
                completed
        );
    }

    private static String incidentStatus(RecoveryVerifiedRestartService.RestartRunStatus status) {
        return switch (status) {
            case RECOVERED -> "RESOLVED";
            case DEPENDENCY_BLOCKED -> "DEPENDENCY_BLOCKED";
            case BUDGET_EXHAUSTED -> "HUMAN_REQUIRED";
            case OUTCOME_UNKNOWN -> "HUMAN_REQUIRED";
            default -> "HUMAN_REQUIRED";
        };
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }

    public record RecoveryWorkflowResult(
            String status,
            String reasoning,
            RecoveryVerifiedRestartService.RestartRunResult recovery,
            RecoveryIncidentRecord openedIncident,
            RecoveryIncidentRecord finalIncident
    ) {
        public RecoveryWorkflowResult {
            status = Objects.requireNonNull(status, "status");
            reasoning = Objects.requireNonNullElse(reasoning, "");
            openedIncident = Objects.requireNonNull(openedIncident, "openedIncident");
            finalIncident = Objects.requireNonNull(finalIncident, "finalIncident");
        }
    }
}
