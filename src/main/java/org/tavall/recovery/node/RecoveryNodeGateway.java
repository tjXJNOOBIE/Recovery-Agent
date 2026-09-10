package org.tavall.recovery.node;

/** External node-agent boundary. Product policy must stay outside implementations of this interface. */
public interface RecoveryNodeGateway extends AutoCloseable {
    String nodeId();

    RecoveryNodeSnapshot inspectNode();

    RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(String serviceId);

    @Override
    default void close() {
    }
}
