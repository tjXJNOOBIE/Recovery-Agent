package org.tavall.recovery;

import org.tavall.ai.agent.AIAgentExecutionResult;
import org.tavall.ai.agent.AIAgentExecutionStatus;
import org.tavall.recovery.runtime.RecoveryApplicationBootstrap;
import org.tavall.recovery.runtime.RecoveryApplicationRuntime;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;

/** Java-first Recovery Agent process entrypoint. */
public final class RecoveryAgentApplication {
    private RecoveryAgentApplication() {
    }

    public static void main(String[] args) {
        try {
            run(List.of(args), System.getenv());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            System.err.println("Recovery Agent was interrupted.");
            System.exit(130);
        } catch (RuntimeException exception) {
            String message = exception.getMessage();
            System.err.println(message == null || message.isBlank()
                    ? exception.getClass().getSimpleName()
                    : message);
            System.exit(1);
        }
    }

    static void run(List<String> arguments, Map<String, String> environment) throws InterruptedException {
        if (arguments.isEmpty()) {
            throw usage();
        }
        String command = arguments.getFirst();
        if ("mcp".equals(command) || "serve".equals(command)) {
            if (arguments.size() != 2) {
                throw new IllegalArgumentException(command + " requires exactly one Recovery control config path");
            }
            serve(Path.of(arguments.get(1)), environment);
            return;
        }
        if ("invoke".equals(command)) {
            if (arguments.size() < 3) {
                throw new IllegalArgumentException("invoke requires a Recovery control config path and request");
            }
            invoke(
                    Path.of(arguments.get(1)),
                    environment,
                    String.join(" ", arguments.subList(2, arguments.size()))
            );
            return;
        }
        throw usage();
    }

    private static void serve(Path configurationPath, Map<String, String> environment) throws InterruptedException {
        try (RecoveryApplicationRuntime runtime = RecoveryApplicationBootstrap.start(configurationPath, environment)) {
            CountDownLatch shutdown = new CountDownLatch(1);
            Runtime.getRuntime().addShutdownHook(new Thread(shutdown::countDown, "recovery-agent-shutdown"));
            System.out.println("Recovery Agent Java operator MCP: " + runtime.operatorMcpEndpoint());
            System.out.println("Mutation tools remain unavailable until the Java recovery policy/approval/durability port is complete.");
            shutdown.await();
        }
    }

    private static void invoke(
            Path configurationPath,
            Map<String, String> environment,
            String request
    ) {
        try (RecoveryApplicationRuntime runtime = RecoveryApplicationBootstrap.start(configurationPath, environment)) {
            AIAgentExecutionResult result = runtime.invoke(request);
            if (result.status() != AIAgentExecutionStatus.COMPLETED) {
                throw new IllegalStateException(result.errorMessage() == null
                        ? result.output().toString()
                        : result.errorMessage());
            }
            String text = result.output().path("text").asText("");
            System.out.println(text.isBlank() ? result.output().toPrettyString() : text);
        }
    }

    private static IllegalArgumentException usage() {
        return new IllegalArgumentException(
                "Usage: recovery-agent mcp <control-config> | recovery-agent invoke <control-config> <request>"
        );
    }
}
