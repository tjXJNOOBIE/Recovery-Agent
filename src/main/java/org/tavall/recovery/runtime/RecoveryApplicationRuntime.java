package org.tavall.recovery.runtime;

import org.tavall.ai.agent.AIAgentExecutionResult;
import org.tavall.ai.agent.strands.StrandsAgentProvider;
import org.tavall.ai.mcp.server.AIFunctionMcpStandaloneHttpServer;
import org.tavall.dependency.maps.DependencyMap;
import org.tavall.recovery.durability.RecoveryRestartIntentService;
import org.tavall.recovery.handler.RecoveryAgentInvocationHandler;
import org.tavall.recovery.node.RecoveryNodeGateway;

import java.net.URI;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;

/** Owns one live Java Recovery control generation and reverse-order cleanup. */
public final class RecoveryApplicationRuntime implements AutoCloseable {
    private final AIFunctionMcpStandaloneHttpServer operatorServer;
    private final StrandsAgentProvider strandsProvider;
    private final List<RecoveryNodeGateway> gateways;
    private final Optional<RecoveryRestartIntentService> restartIntentService;
    private final AtomicBoolean closed = new AtomicBoolean();

    public RecoveryApplicationRuntime(
            AIFunctionMcpStandaloneHttpServer operatorServer,
            StrandsAgentProvider strandsProvider,
            List<RecoveryNodeGateway> gateways,
            Optional<RecoveryRestartIntentService> restartIntentService
    ) {
        this.operatorServer = Objects.requireNonNull(operatorServer, "operatorServer");
        this.strandsProvider = Objects.requireNonNull(strandsProvider, "strandsProvider");
        this.gateways = List.copyOf(Objects.requireNonNull(gateways, "gateways"));
        this.restartIntentService = Objects.requireNonNull(restartIntentService, "restartIntentService");
    }

    public URI operatorMcpEndpoint() {
        ensureOpen();
        return operatorServer.localEndpointUri();
    }

    public AIAgentExecutionResult invoke(String request) {
        ensureOpen();
        return new RecoveryAgentInvocationHandler().invoke(request);
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        RuntimeException failure = null;
        try {
            operatorServer.close();
        } catch (RuntimeException exception) {
            failure = exception;
        }
        try {
            strandsProvider.close();
        } catch (RuntimeException exception) {
            failure = appendFailure(failure, exception);
        }
        if (restartIntentService.isPresent()) {
            try {
                restartIntentService.get().close();
            } catch (RuntimeException exception) {
                failure = appendFailure(failure, exception);
            }
        }
        for (int index = gateways.size() - 1; index >= 0; index--) {
            try {
                gateways.get(index).close();
            } catch (RuntimeException exception) {
                failure = appendFailure(failure, exception);
            }
        }
        DependencyMap.getDependencyMap().removeDependency(RecoveryDependencies.class);

        if (failure != null) {
            throw failure;
        }
    }

    private void ensureOpen() {
        if (closed.get()) {
            throw new IllegalStateException("Recovery Agent runtime is closed.");
        }
    }

    private static RuntimeException appendFailure(RuntimeException current, RuntimeException next) {
        if (current == null) {
            return next;
        }
        current.addSuppressed(next);
        return current;
    }
}
