package org.tavall.recovery.node;

/** External node-agent boundary. Product policy must stay outside implementations of this interface. */
public interface RecoveryNodeGateway extends AutoCloseable {
    String nodeId();

    RecoveryNodeSnapshot inspectNode();

    RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(String serviceId);

    /**
     * Execute one deterministic restart effect on the external node agent.
     *
     * <p>The default is fail-closed so read-only gateways and test doubles do not accidentally gain mutation
     * authority merely because the interface grew a mutation method.</p>
     */
    default RecoveryServiceActionResult restartService(String serviceId) {
        throw new UnsupportedOperationException("Recovery node gateway does not support service restart");
    }

    @Override
    default void close() {
    }
}
