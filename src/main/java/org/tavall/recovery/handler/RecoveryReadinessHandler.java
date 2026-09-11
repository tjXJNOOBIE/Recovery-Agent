package org.tavall.recovery.handler;

import org.tavall.ai.core.annotation.AIFunction;
import org.tavall.dependency.DependencyAccess;
import org.tavall.recovery.budget.RecoveryAutomaticRestartBudgetEvaluator;
import org.tavall.recovery.config.RecoveryControlConfiguration;
import org.tavall.recovery.durability.RecoveryRestartIntentService;
import org.tavall.recovery.node.RecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeSnapshot;
import org.tavall.recovery.policy.RecoveryDecision;
import org.tavall.recovery.policy.RecoveryPolicyResolver;
import org.tavall.recovery.policy.ServiceRecoveryPolicy;
import org.tavall.recovery.runtime.RecoveryDependencies;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Trusted read-only operator readiness surface. */
public final class RecoveryReadinessHandler implements DependencyAccess<RecoveryDependencies> {
    private final RecoveryPolicyResolver policyResolver = new RecoveryPolicyResolver();
    private final RecoveryAutomaticRestartBudgetEvaluator budgetEvaluator =
            new RecoveryAutomaticRestartBudgetEvaluator();

    @AIFunction(
            name = "recovery_readiness",
            description = "Inspect deterministic restart policy, durable rolling budget, and dependency health without performing any mutation."
    )
    public RecoveryReadinessReport inspectReadiness() {
        RecoveryDependencies dependencies = getInstance();
        Instant observedAt = Instant.now();
        DurableBudgetContext durableBudget = durableBudget(dependencies);
        List<ServiceReadiness> services = ServiceRecoveryPolicy.all(dependencies.configuration()).stream()
                .map(policy -> inspectService(dependencies, policy, durableBudget, observedAt))
                .toList();
        return new RecoveryReadinessReport(
                observedAt.toString(),
                services,
                count(services, ReadinessStatus.HEALTHY),
                count(services, ReadinessStatus.POLICY_ELIGIBLE),
                count(services, ReadinessStatus.BLOCKED),
                count(services, ReadinessStatus.HUMAN_REQUIRED),
                count(services, ReadinessStatus.INVESTIGATE),
                count(services, ReadinessStatus.UNREACHABLE),
                durableBudget.available(),
                durableBudget.error(),
                false
        );
    }

    private DurableBudgetContext durableBudget(RecoveryDependencies dependencies) {
        if (dependencies.restartIntentService().isEmpty()) {
            return new DurableBudgetContext(
                    false,
                    List.of(),
                    "Recovery durable state is not configured"
            );
        }
        RecoveryRestartIntentService service = dependencies.restartIntentService().orElseThrow();
        if (!service.isAvailable()) {
            return new DurableBudgetContext(
                    false,
                    List.of(),
                    "Recovery durable state authority is unavailable"
            );
        }
        try {
            return new DurableBudgetContext(true, service.loadAttempts(), null);
        } catch (RuntimeException exception) {
            return new DurableBudgetContext(
                    false,
                    List.of(),
                    "Recovery durable state could not be loaded: " + message(exception)
            );
        }
    }

    private ServiceReadiness inspectService(
            RecoveryDependencies dependencies,
            ServiceRecoveryPolicy policy,
            DurableBudgetContext durableBudget,
            Instant observedAt
    ) {
        RecoveryAutomaticRestartBudgetEvaluator.BudgetSnapshot budget = durableBudget.available()
                ? budgetEvaluator.inspect(policy, durableBudget.attempts(), observedAt)
                : null;
        RecoveryNodeSnapshot.RecoveryServiceSnapshot target;
        try {
            target = dependencies.gateways().require(policy.nodeId()).inspectService(policy.serviceId());
        } catch (RuntimeException exception) {
            return new ServiceReadiness(
                    policy.nodeId(),
                    policy.serviceId(),
                    ReadinessStatus.UNREACHABLE,
                    null,
                    false,
                    false,
                    policy.restartAllowed(),
                    policy.maxRestartAttempts(),
                    policy.restartBudgetWindowSeconds(),
                    durableBudget.available(),
                    budget,
                    false,
                    false,
                    false,
                    List.of(),
                    List.of("Target node/service is unreachable: " + message(exception))
            );
        }

        RecoveryDecision decision = policyResolver.resolve(target, policy);
        List<DependencyReadiness> dependencyReadiness = inspectDependencies(dependencies, policy);
        List<DependencyReadiness> dependencyProblems = dependencyReadiness.stream()
                .filter(dependency -> !dependency.reachable() || !dependency.healthy())
                .toList();
        List<String> reasons = new ArrayList<>();
        if (!policy.restartAllowed()) {
            reasons.add("Automatic restart is disabled by machine policy");
        }
        if (policy.maxRestartAttempts() == 0) {
            reasons.add("Automatic restart policy has zero allowed attempts");
        }
        if (!dependencyProblems.isEmpty()) {
            reasons.add("Dependency health blocks recovery: " + dependencyProblems.stream()
                    .map(dependency -> dependency.nodeId() + "/" + dependency.serviceId())
                    .reduce((left, right) -> left + ", " + right)
                    .orElse("unknown dependency"));
        }
        if (decision == RecoveryDecision.HUMAN_REQUIRED) {
            reasons.add("Observed lifecycle state is unknown; automatic mutation is refused");
        } else if (decision == RecoveryDecision.INVESTIGATE) {
            reasons.add("Observed state does not satisfy deterministic automatic-restart policy");
        }
        if (!durableBudget.available()) {
            reasons.add(durableBudget.error() + "; automatic mutation is disabled");
        } else if (budget != null && budget.remainingAttempts() == 0 && policy.maxRestartAttempts() > 0) {
            reasons.add(
                    "Automatic restart budget is exhausted: " + budget.usedAttempts() + "/"
                            + budget.maximumAttempts() + " used in " + budget.windowMillis() + "ms"
            );
        }

        boolean policyEligible = decision == RecoveryDecision.RESTART && dependencyProblems.isEmpty();
        boolean automaticRecoveryPreconditionsSatisfied = policyEligible
                && durableBudget.available()
                && budget != null
                && budget.remainingAttempts() > 0;
        if (automaticRecoveryPreconditionsSatisfied) {
            reasons.add(
                    "Policy, dependency, and durable budget preconditions pass, but mutation remains disabled until operation exclusion, verified effects, incidents, and approval reconciliation are ported to Java"
            );
        }

        return new ServiceReadiness(
                policy.nodeId(),
                policy.serviceId(),
                status(decision, dependencyProblems),
                decision,
                true,
                decision == RecoveryDecision.HEALTHY,
                policy.restartAllowed(),
                policy.maxRestartAttempts(),
                policy.restartBudgetWindowSeconds(),
                durableBudget.available(),
                budget,
                policyEligible,
                automaticRecoveryPreconditionsSatisfied,
                false,
                dependencyReadiness,
                List.copyOf(reasons)
        );
    }

    private List<DependencyReadiness> inspectDependencies(
            RecoveryDependencies dependencies,
            ServiceRecoveryPolicy policy
    ) {
        List<DependencyReadiness> result = new ArrayList<>();
        for (RecoveryControlConfiguration.Dependency dependency : policy.dependencies()) {
            ServiceRecoveryPolicy dependencyPolicy = ServiceRecoveryPolicy.resolve(
                    dependencies.configuration(),
                    dependency.nodeId(),
                    dependency.serviceId()
            );
            RecoveryNodeGateway gateway = dependencies.gateways().require(dependency.nodeId());
            try {
                RecoveryNodeSnapshot.RecoveryServiceSnapshot snapshot = gateway.inspectService(dependency.serviceId());
                boolean healthy = policyResolver.resolve(snapshot, dependencyPolicy) == RecoveryDecision.HEALTHY;
                result.add(new DependencyReadiness(
                        dependency.nodeId(),
                        dependency.serviceId(),
                        true,
                        healthy,
                        snapshot.detail(),
                        null
                ));
            } catch (RuntimeException exception) {
                result.add(new DependencyReadiness(
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

    private static ReadinessStatus status(
            RecoveryDecision decision,
            List<DependencyReadiness> dependencyProblems
    ) {
        if (!dependencyProblems.isEmpty()) {
            return ReadinessStatus.BLOCKED;
        }
        return switch (decision) {
            case HEALTHY -> ReadinessStatus.HEALTHY;
            case RESTART -> ReadinessStatus.POLICY_ELIGIBLE;
            case HUMAN_REQUIRED -> ReadinessStatus.HUMAN_REQUIRED;
            case INVESTIGATE -> ReadinessStatus.INVESTIGATE;
        };
    }

    private static int count(List<ServiceReadiness> services, ReadinessStatus status) {
        return Math.toIntExact(services.stream().filter(service -> service.status() == status).count());
    }

    private static String message(RuntimeException exception) {
        String value = exception.getMessage();
        return value == null || value.isBlank() ? exception.getClass().getSimpleName() : value;
    }

    public enum ReadinessStatus {
        HEALTHY,
        POLICY_ELIGIBLE,
        BLOCKED,
        HUMAN_REQUIRED,
        INVESTIGATE,
        UNREACHABLE
    }

    public record RecoveryReadinessReport(
            String observedAt,
            List<ServiceReadiness> services,
            int healthyServices,
            int policyEligibleServices,
            int blockedServices,
            int humanRequiredServices,
            int investigateServices,
            int unreachableServices,
            boolean durableStateAvailable,
            String durableStateError,
            boolean mutationCutoverComplete
    ) {
        public RecoveryReadinessReport {
            services = List.copyOf(services);
        }
    }

    public record ServiceReadiness(
            String nodeId,
            String serviceId,
            ReadinessStatus status,
            RecoveryDecision decision,
            boolean targetReachable,
            boolean targetHealthy,
            boolean restartAllowed,
            int maximumRestartAttempts,
            int restartBudgetWindowSeconds,
            boolean durableStateAvailable,
            RecoveryAutomaticRestartBudgetEvaluator.BudgetSnapshot automaticBudget,
            boolean restartPolicyEligible,
            boolean automaticRecoveryPreconditionsSatisfied,
            boolean mutationAvailable,
            List<DependencyReadiness> dependencies,
            List<String> reasons
    ) {
        public ServiceReadiness {
            dependencies = List.copyOf(dependencies);
            reasons = List.copyOf(reasons);
        }
    }

    public record DependencyReadiness(
            String nodeId,
            String serviceId,
            boolean reachable,
            boolean healthy,
            String detail,
            String error
    ) {
    }

    private record DurableBudgetContext(
            boolean available,
            List<RecoveryAutomaticRestartBudgetEvaluator.RestartAttempt> attempts,
            String error
    ) {
        private DurableBudgetContext {
            attempts = List.copyOf(attempts);
        }
    }
}
