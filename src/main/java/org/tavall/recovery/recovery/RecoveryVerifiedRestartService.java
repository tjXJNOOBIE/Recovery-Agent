package org.tavall.recovery.recovery;

import org.tavall.recovery.budget.RecoveryAutomaticRestartBudgetEvaluator;
import org.tavall.recovery.config.RecoveryControlConfiguration;
import org.tavall.recovery.durability.RecoveryRestartIntentService;
import org.tavall.recovery.node.RecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeGatewayResolver;
import org.tavall.recovery.node.RecoveryNodeSnapshot;
import org.tavall.recovery.node.RecoveryServiceActionResult;
import org.tavall.recovery.policy.RecoveryDecision;
import org.tavall.recovery.policy.RecoveryPolicyResolver;
import org.tavall.recovery.policy.ServiceRecoveryPolicy;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Deterministic Java restart effect sequence.
 *
 * <p>This service is intentionally not an AI Function. It is the internal mutation boundary that a trusted
 * operator handler may consume only after incident/approval reconciliation is also Java-owned.</p>
 *
 * <p>The synchronized entry point conservatively serializes all automatic restart effects in one product
 * process. That is deliberately broader than the legacy per-target gate and avoids reintroducing an
 * application-owned mutable keyed operation registry.</p>
 */
public final class RecoveryVerifiedRestartService {
    private final RecoveryControlConfiguration configuration;
    private final RecoveryNodeGatewayResolver gateways;
    private final RecoveryRestartIntentService restartIntents;
    private final RecoveryPolicyResolver policyResolver;
    private final RecoveryAutomaticRestartBudgetEvaluator budgetEvaluator;

    public RecoveryVerifiedRestartService(
            RecoveryControlConfiguration configuration,
            RecoveryNodeGatewayResolver gateways,
            RecoveryRestartIntentService restartIntents
    ) {
        this(
                configuration,
                gateways,
                restartIntents,
                new RecoveryPolicyResolver(),
                new RecoveryAutomaticRestartBudgetEvaluator()
        );
    }

    RecoveryVerifiedRestartService(
            RecoveryControlConfiguration configuration,
            RecoveryNodeGatewayResolver gateways,
            RecoveryRestartIntentService restartIntents,
            RecoveryPolicyResolver policyResolver,
            RecoveryAutomaticRestartBudgetEvaluator budgetEvaluator
    ) {
        this.configuration = Objects.requireNonNull(configuration, "configuration");
        this.gateways = Objects.requireNonNull(gateways, "gateways");
        this.restartIntents = Objects.requireNonNull(restartIntents, "restartIntents");
        this.policyResolver = Objects.requireNonNull(policyResolver, "policyResolver");
        this.budgetEvaluator = Objects.requireNonNull(budgetEvaluator, "budgetEvaluator");
    }

    /**
     * Attempt at most one deterministic automatic restart.
     *
     * <p>A consumed durable intent is never rolled back. If the effect outcome becomes unknown, the caller must
     * reconcile by observation/human workflow rather than blindly retrying.</p>
     */
    public synchronized RestartRunResult attemptAutomaticRestart(
            String nodeId,
            String serviceId,
            Instant now
    ) {
        Instant safeNow = Objects.requireNonNull(now, "now");
        ServiceRecoveryPolicy policy = ServiceRecoveryPolicy.resolve(configuration, nodeId, serviceId);
        RecoveryNodeGateway gateway = gateways.require(policy.nodeId());

        RecoveryNodeSnapshot.RecoveryServiceSnapshot before;
        try {
            before = gateway.inspectService(policy.serviceId());
        } catch (RuntimeException exception) {
            return result(
                    RestartRunStatus.TARGET_UNREACHABLE,
                    policy,
                    null,
                    null,
                    null,
                    List.of(),
                    message(exception)
            );
        }

        RecoveryDecision decision = policyResolver.resolve(before, policy);
        if (decision == RecoveryDecision.HEALTHY) {
            return result(
                    RestartRunStatus.HEALTHY_NO_ACTION,
                    policy,
                    before,
                    before,
                    null,
                    List.of(),
                    "Target is already healthy"
            );
        }
        if (decision != RecoveryDecision.RESTART) {
            return result(
                    decision == RecoveryDecision.HUMAN_REQUIRED
                            ? RestartRunStatus.HUMAN_REQUIRED
                            : RestartRunStatus.POLICY_REFUSED,
                    policy,
                    before,
                    before,
                    null,
                    List.of(),
                    "Deterministic policy refused automatic restart: " + decision
            );
        }

        List<DependencyResult> dependencies = inspectDependencies(policy);
        List<DependencyResult> blocking = dependencies.stream()
                .filter(dependency -> !dependency.reachable() || !dependency.healthy())
                .toList();
        if (!blocking.isEmpty()) {
            return result(
                    RestartRunStatus.DEPENDENCY_BLOCKED,
                    policy,
                    before,
                    before,
                    null,
                    dependencies,
                    "Dependency health blocks automatic restart"
            );
        }

        RecoveryRestartIntentService.RestartIntentReservation reservation =
                restartIntents.reserveAutomaticRestartIntent(policy, safeNow, budgetEvaluator);
        if (!reservation.allowed()) {
            return new RestartRunResult(
                    RestartRunStatus.BUDGET_EXHAUSTED,
                    policy.nodeId(),
                    policy.serviceId(),
                    before,
                    before,
                    null,
                    dependencies,
                    reservation.budget(),
                    false,
                    "Automatic restart budget is exhausted"
            );
        }

        RecoveryServiceActionResult action;
        try {
            action = gateway.restartService(policy.serviceId());
        } catch (RuntimeException exception) {
            return new RestartRunResult(
                    RestartRunStatus.OUTCOME_UNKNOWN,
                    policy.nodeId(),
                    policy.serviceId(),
                    before,
                    null,
                    null,
                    dependencies,
                    reservation.budget(),
                    true,
                    "Restart intent is durable but node effect outcome is unknown: " + message(exception)
            );
        }

        RecoveryNodeSnapshot.RecoveryServiceSnapshot after;
        try {
            after = gateway.inspectService(policy.serviceId());
        } catch (RuntimeException exception) {
            return new RestartRunResult(
                    RestartRunStatus.OUTCOME_UNKNOWN,
                    policy.nodeId(),
                    policy.serviceId(),
                    before,
                    null,
                    action,
                    dependencies,
                    reservation.budget(),
                    true,
                    "Restart effect returned but deterministic verification failed: " + message(exception)
            );
        }

        if (!action.accepted()) {
            return new RestartRunResult(
                    RestartRunStatus.RESTART_REJECTED,
                    policy.nodeId(),
                    policy.serviceId(),
                    before,
                    after,
                    action,
                    dependencies,
                    reservation.budget(),
                    true,
                    "Node agent rejected the restart request"
            );
        }
        if (policyResolver.isHealthy(after, policy)) {
            return new RestartRunResult(
                    RestartRunStatus.RECOVERED,
                    policy.nodeId(),
                    policy.serviceId(),
                    before,
                    after,
                    action,
                    dependencies,
                    reservation.budget(),
                    true,
                    "Durable restart intent was executed and verified healthy"
            );
        }
        return new RestartRunResult(
                RestartRunStatus.VERIFICATION_FAILED,
                policy.nodeId(),
                policy.serviceId(),
                before,
                after,
                action,
                dependencies,
                reservation.budget(),
                true,
                "Restart was accepted but deterministic verification did not restore health"
        );
    }

    private List<DependencyResult> inspectDependencies(ServiceRecoveryPolicy policy) {
        List<DependencyResult> result = new ArrayList<>();
        for (RecoveryControlConfiguration.Dependency dependency : policy.dependencies()) {
            ServiceRecoveryPolicy dependencyPolicy = ServiceRecoveryPolicy.resolve(
                    configuration,
                    dependency.nodeId(),
                    dependency.serviceId()
            );
            try {
                RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot = gateways
                        .require(dependency.nodeId())
                        .inspectService(dependency.serviceId());
                result.add(new DependencyResult(
                        dependency.nodeId(),
                        dependency.serviceId(),
                        true,
                        policyResolver.isHealthy(snapshot, dependencyPolicy),
                        snapshot.detail(),
                        null
                ));
            } catch (RuntimeException exception) {
                result.add(new DependencyResult(
                        dependency.nodeId(),
                        dependency.serviceId(),
                        false,
                        false,
                        null,
                        message(exception)
                ));
            }
        }
        return List.copyOf(result);
    }

    private static RestartRunResult result(
            RestartRunStatus status,
            ServiceRecoveryPolicy policy,
            RecoveryNodeSnapshot.RecoveryServiceSnapshot before,
            RecoveryNodeSnapshot.RecoveryServiceSnapshot after,
            RecoveryServiceActionResult action,
            List<DependencyResult> dependencies,
            String message
    ) {
        return new RestartRunResult(
                status,
                policy.nodeId(),
                policy.serviceId(),
                before,
                after,
                action,
                dependencies,
                null,
                false,
                message
        );
    }

    private static String message(RuntimeException exception) {
        String value = exception.getMessage();
        return value == null || value.isBlank() ? exception.getClass().getSimpleName() : value;
    }

    public enum RestartRunStatus {
        HEALTHY_NO_ACTION,
        TARGET_UNREACHABLE,
        POLICY_REFUSED,
        HUMAN_REQUIRED,
        DEPENDENCY_BLOCKED,
        BUDGET_EXHAUSTED,
        RECOVERED,
        RESTART_REJECTED,
        VERIFICATION_FAILED,
        OUTCOME_UNKNOWN
    }

    public record RestartRunResult(
            RestartRunStatus status,
            String nodeId,
            String serviceId,
            RecoveryNodeSnapshot.RecoveryServiceSnapshot before,
            RecoveryNodeSnapshot.RecoveryServiceSnapshot after,
            RecoveryServiceActionResult action,
            List<DependencyResult> dependencies,
            RecoveryAutomaticRestartBudgetEvaluator.BudgetSnapshot budget,
            boolean durableIntentCommitted,
            String message
    ) {
        public RestartRunResult {
            status = Objects.requireNonNull(status, "status");
            nodeId = Objects.requireNonNull(nodeId, "nodeId");
            serviceId = Objects.requireNonNull(serviceId, "serviceId");
            dependencies = List.copyOf(Objects.requireNonNull(dependencies, "dependencies"));
            message = Objects.requireNonNullElse(message, "");
        }
    }

    public record DependencyResult(
            String nodeId,
            String serviceId,
            boolean reachable,
            boolean healthy,
            String detail,
            String error
    ) {
    }
}
