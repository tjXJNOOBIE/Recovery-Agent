package org.tavall.recovery.handler;

import org.tavall.ai.core.annotation.AIFunction;
import org.tavall.dependency.DependencyAccess;
import org.tavall.recovery.config.RecoveryControlConfiguration;
import org.tavall.recovery.node.RecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeSnapshot;
import org.tavall.recovery.policy.RecoveryDecision;
import org.tavall.recovery.policy.RecoveryPolicyResolver;
import org.tavall.recovery.policy.ServiceRecoveryPolicy;
import org.tavall.recovery.runtime.RecoveryDependencies;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Trusted read-only operator readiness surface.
 *
 * <p>This reports deterministic policy/dependency state but deliberately does not claim that a restart is
 * executable. Durable budget state, operation exclusion, restart-intent checkpointing, incident state, and
 * approval reconciliation must be Java-owned before mutation can be enabled.</p>
 */
public final class RecoveryReadinessHandler implements DependencyAccess<RecoveryDependencies> {
    private final RecoveryPolicyResolver policyResolver = new RecoveryPolicyResolver();

    @AIFunction(
            name = "recovery_readiness",
            description = "Inspect deterministic restart policy and dependency health without performing any mutation."
    )
    public RecoveryReadinessReport inspectReadiness() {
        RecoveryDependencies dependencies = getInstance();
        List<ServiceReadiness> services = ServiceRecoveryPolicy.all(dependencies.configuration()).stream()
                .map(policy -> inspectService(dependencies, policy))
                .toList();
        return new RecoveryReadinessReport(
                Instant.now().toString(),
                services,
                count(services, ReadinessStatus.HEALTHY),
                count(services, ReadinessStatus.POLICY_ELIGIBLE),
                count(services, ReadinessStatus.BLOCKED),
                count(services, ReadinessStatus.HUMAN_REQUIRED),
                count(services, ReadinessStatus.INVESTIGATE),
                count(services, ReadinessStatus.UNREACHABLE),
                false
        );
    }

    private ServiceReadiness inspectService(
            RecoveryDependencies dependencies,
            ServiceRecoveryPolicy policy
    ) {
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

        boolean policyEligible = decision == RecoveryDecision.RESTART && dependencyProblems.isEmpty();
        if (policyEligible) {
            reasons.add("Policy/dependency preconditions permit restart evaluation, but mutation remains disabled until durable budget, exclusion, checkpoint, incident, and approval authority are ported to Java");
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
                policyEligible,
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
            boolean restartPolicyEligible,
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
}
