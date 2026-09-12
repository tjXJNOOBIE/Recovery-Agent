package org.tavall.recovery.handler;

import org.tavall.ai.core.annotation.AIFunction;
import org.tavall.ai.core.annotation.AIParam;
import org.tavall.dependency.DependencyAccess;
import org.tavall.recovery.node.RecoveryNodeGateway;
import org.tavall.recovery.node.RecoveryNodeSnapshot;
import org.tavall.recovery.runtime.RecoveryDependencies;

import java.util.ArrayList;
import java.util.List;

/** Read-only Recovery capabilities. Node failures remain observations rather than hiding healthy fleet state. */
public final class RecoveryObservationHandler implements DependencyAccess<RecoveryDependencies> {
    @AIFunction(
            name = "fleet_status",
            description = "Inspect reachable node/service health and report unreachable nodes without hiding the rest of the fleet."
    )
    public FleetStatusResult fleetStatus() {
        RecoveryDependencies dependencies = getInstance();
        List<RecoveryNodeSnapshot> nodes = new ArrayList<>();
        List<UnreachableNodeObservation> unreachableNodes = new ArrayList<>();

        for (RecoveryNodeGateway gateway : dependencies.gateways().all()) {
            try {
                nodes.add(gateway.inspectNode());
            } catch (RuntimeException exception) {
                unreachableNodes.add(new UnreachableNodeObservation(
                        gateway.nodeId(),
                        errorMessage(exception)
                ));
            }
        }

        int healthyServices = 0;
        int unhealthyServices = 0;
        for (RecoveryNodeSnapshot node : nodes) {
            for (RecoveryNodeSnapshot.RecoveryServiceSnapshot service : node.services()) {
                if (service.healthy()) {
                    healthyServices++;
                } else {
                    unhealthyServices++;
                }
            }
        }
        return new FleetStatusResult(nodes, unreachableNodes, healthyServices, unhealthyServices);
    }

    @AIFunction(
            name = "node_inspect",
            description = "Inspect one configured Recovery node."
    )
    public RecoveryNodeSnapshot inspectNode(
            @AIParam(name = "nodeId", description = "Configured Recovery node ID") String nodeId
    ) {
        return getInstance().gateways().require(nodeId).inspectNode();
    }

    @AIFunction(
            name = "service_inspect",
            description = "Inspect one configured Recovery service."
    )
    public RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(
            @AIParam(name = "nodeId", description = "Configured Recovery node ID") String nodeId,
            @AIParam(name = "serviceId", description = "Configured service ID on the node") String serviceId
    ) {
        return getInstance().gateways().require(nodeId).inspectService(requireText(serviceId, "serviceId"));
    }

    private static String errorMessage(RuntimeException exception) {
        String message = exception.getMessage();
        return message == null || message.isBlank() ? exception.getClass().getSimpleName() : message;
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }

    public record FleetStatusResult(
            List<RecoveryNodeSnapshot> nodes,
            List<UnreachableNodeObservation> unreachableNodes,
            int healthyServices,
            int unhealthyServices
    ) {
        public FleetStatusResult {
            nodes = List.copyOf(nodes);
            unreachableNodes = List.copyOf(unreachableNodes);
        }
    }

    public record UnreachableNodeObservation(String nodeId, String error) {
    }
}
