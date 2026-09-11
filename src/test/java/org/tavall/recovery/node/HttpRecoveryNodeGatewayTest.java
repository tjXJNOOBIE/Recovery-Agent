package org.tavall.recovery.node;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class HttpRecoveryNodeGatewayTest {
    @Test
    void restartUsesAuthenticatedNodeContractAndParsesTypedResult() throws Exception {
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        // HttpServer context matching operates on the decoded path. Mount the stable prefix and assert the
        // exact encoded wire path from the exchange instead of baking percent encoding into the context key.
        server.createContext("/v1/services/", exchange -> {
            method.set(exchange.getRequestMethod());
            path.set(exchange.getRequestURI().getRawPath());
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            writeJson(exchange, """
                    {
                      "accepted": true,
                      "action": "restart",
                      "message": "accepted",
                      "snapshot": {
                        "nodeId": "east",
                        "serviceId": "api worker",
                        "lifecycleState": "running",
                        "healthy": true,
                        "detail": "healthy",
                        "observedAt": "2026-09-11T03:40:00Z",
                        "restartCount": 1,
                        "healthChecks": []
                      }
                    }
                    """);
        });
        server.start();

        try {
            URI baseUri = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/");
            HttpRecoveryNodeGateway gateway = new HttpRecoveryNodeGateway(
                    "east",
                    baseUri,
                    "0123456789abcdef",
                    new ObjectMapper().findAndRegisterModules()
            );

            RecoveryServiceActionResult result = gateway.restartService("api worker");

            assertThat(method.get()).isEqualTo("POST");
            assertThat(path.get()).isEqualTo("/v1/services/api%20worker/restart");
            assertThat(authorization.get()).isEqualTo("Bearer 0123456789abcdef");
            assertThat(result.accepted()).isTrue();
            assertThat(result.action()).isEqualTo("restart");
            assertThat(result.snapshot().serviceId()).isEqualTo("api worker");
            assertThat(result.snapshot().healthy()).isTrue();
            assertThat(result.snapshot().healthChecks()).isEqualTo(List.of());
        } finally {
            server.stop(0);
        }
    }

    private static void writeJson(HttpExchange exchange, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }
}
