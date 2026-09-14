package org.tavall.recovery.node;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Objects;

/** Loopback compatibility adapter for the existing Recovery node-agent HTTP contract. */
public final class HttpRecoveryNodeGateway implements RecoveryNodeGateway {
    private final String nodeId;
    private final URI baseUri;
    private final String bearerToken;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public HttpRecoveryNodeGateway(
            String nodeId,
            URI baseUri,
            String bearerToken,
            ObjectMapper objectMapper
    ) {
        this.nodeId = requireText(nodeId, "nodeId");
        this.baseUri = Objects.requireNonNull(baseUri, "baseUri");
        this.bearerToken = requireToken(bearerToken);
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    @Override
    public String nodeId() {
        return nodeId;
    }

    @Override
    public RecoveryNodeSnapshot inspectNode() {
        return request("GET", "/v1/node", RecoveryNodeSnapshot.class);
    }

    @Override
    public RecoveryNodeSnapshot.RecoveryServiceSnapshot inspectService(String serviceId) {
        return request(
                "GET",
                "/v1/services/" + encodeServiceId(serviceId),
                RecoveryNodeSnapshot.RecoveryServiceSnapshot.class
        );
    }

    @Override
    public RecoveryServiceActionResult restartService(String serviceId) {
        return request(
                "POST",
                "/v1/services/" + encodeServiceId(serviceId) + "/restart",
                RecoveryServiceActionResult.class
        );
    }

    private String encodeServiceId(String serviceId) {
        return URLEncoder.encode(requireText(serviceId, "serviceId"), StandardCharsets.UTF_8)
                .replace("+", "%20");
    }

    private <T> T request(String method, String path, Class<T> responseType) {
        URI target = baseUri.resolve(path.startsWith("/") ? path.substring(1) : path);
        HttpRequest request = HttpRequest.newBuilder(target)
                .timeout(Duration.ofSeconds(10))
                .header("Authorization", "Bearer " + bearerToken)
                .method(method, HttpRequest.BodyPublishers.noBody())
                .build();
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException(
                        "Node " + nodeId + " request failed (" + response.statusCode() + "): " + response.body()
                );
            }
            return objectMapper.readValue(response.body(), responseType);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Node " + nodeId + " request was interrupted", exception);
        } catch (IOException exception) {
            throw new IllegalStateException("Node " + nodeId + " request failed", exception);
        }
    }

    private static String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim();
    }

    private static String requireToken(String value) {
        String token = requireText(value, "bearerToken");
        if (token.length() < 16) {
            throw new IllegalArgumentException("Recovery node bearer token must contain at least 16 characters");
        }
        return token;
    }
}
