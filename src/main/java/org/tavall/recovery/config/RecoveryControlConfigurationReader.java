package org.tavall.recovery.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/** Reads the current Recovery control schema without weakening loopback transport constraints. */
public final class RecoveryControlConfigurationReader {
    private final ObjectMapper objectMapper;

    public RecoveryControlConfigurationReader(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public RecoveryControlConfiguration read(Path path) {
        Objects.requireNonNull(path, "path");
        try {
            JsonNode root = objectMapper.readTree(path.toFile());
            return read(root);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to read Recovery control config " + path, exception);
        }
    }

    RecoveryControlConfiguration read(JsonNode root) {
        requireObject(root, "control config");
        JsonNode transportNode = root.path("transport");
        String mode = transportNode.isMissingNode() || transportNode.isNull()
                ? "loopback_http"
                : requiredText(requireObject(transportNode, "transport"), "mode");
        if (!"loopback_http".equals(mode)) {
            throw new IllegalArgumentException(
                    "Java-first Recovery control currently requires loopback_http; outbound_tls will cut over with the session transport slice"
            );
        }

        JsonNode nodesNode = root.get("nodes");
        if (nodesNode == null || !nodesNode.isArray() || nodesNode.isEmpty()) {
            throw new IllegalArgumentException("control config nodes must be a non-empty array");
        }

        List<RecoveryControlConfiguration.Node> nodes = new ArrayList<>();
        Set<String> nodeIds = new HashSet<>();
        for (int nodeIndex = 0; nodeIndex < nodesNode.size(); nodeIndex++) {
            JsonNode node = requireObject(nodesNode.get(nodeIndex), "nodes[" + nodeIndex + "]");
            String nodeId = requiredText(node, "id");
            if (!nodeIds.add(nodeId)) {
                throw new IllegalArgumentException("Duplicate recovery node id: " + nodeId);
            }
            URI baseUri = loopbackUri(requiredText(node, "baseUrl"), "nodes[" + nodeIndex + "].baseUrl");
            String tokenVariable = requiredText(node, "tokenEnvironmentVariable");
            JsonNode servicesNode = node.get("services");
            if (servicesNode == null || !servicesNode.isArray() || servicesNode.isEmpty()) {
                throw new IllegalArgumentException("nodes[" + nodeIndex + "].services must be non-empty");
            }

            List<RecoveryControlConfiguration.Service> services = new ArrayList<>();
            Set<String> serviceIds = new HashSet<>();
            for (int serviceIndex = 0; serviceIndex < servicesNode.size(); serviceIndex++) {
                JsonNode service = requireObject(
                        servicesNode.get(serviceIndex),
                        "nodes[" + nodeIndex + "].services[" + serviceIndex + "]"
                );
                String serviceId = requiredText(service, "id");
                if (!serviceIds.add(serviceId)) {
                    throw new IllegalArgumentException("Duplicate recovery service id on " + nodeId + ": " + serviceId);
                }
                services.add(new RecoveryControlConfiguration.Service(
                        serviceId,
                        requiredBoolean(service, "restartAllowed"),
                        nonNegativeInteger(service, "maxRestartAttempts"),
                        positiveIntegerOrDefault(service, "restartBudgetWindowSeconds", 600),
                        booleanOrDefault(service, "watchEnabled", true),
                        positiveIntegerOrDefault(service, "watchIntervalSeconds", 30),
                        dependencies(service, nodeId)
                ));
            }
            nodes.add(new RecoveryControlConfiguration.Node(nodeId, baseUri, tokenVariable, services));
        }

        RecoveryControlConfiguration configuration = new RecoveryControlConfiguration(
                new RecoveryControlConfiguration.Transport(mode),
                nodes
        );
        validateTopology(configuration);
        return configuration;
    }

    private static List<RecoveryControlConfiguration.Dependency> dependencies(JsonNode service, String defaultNodeId) {
        JsonNode values = service.get("dependencies");
        if (values == null || values.isNull()) {
            return List.of();
        }
        if (!values.isArray()) {
            throw new IllegalArgumentException("service dependencies must be an array when provided");
        }
        List<RecoveryControlConfiguration.Dependency> dependencies = new ArrayList<>();
        for (int index = 0; index < values.size(); index++) {
            JsonNode dependency = requireObject(values.get(index), "dependency[" + index + "]");
            String nodeId = optionalText(dependency, "nodeId", defaultNodeId);
            dependencies.add(new RecoveryControlConfiguration.Dependency(
                    nodeId,
                    requiredText(dependency, "serviceId")
            ));
        }
        return dependencies;
    }

    private static void validateTopology(RecoveryControlConfiguration configuration) {
        Set<String> targets = new HashSet<>();
        for (RecoveryControlConfiguration.Node node : configuration.nodes()) {
            for (RecoveryControlConfiguration.Service service : node.services()) {
                targets.add(target(node.id(), service.id()));
            }
        }
        for (RecoveryControlConfiguration.Node node : configuration.nodes()) {
            for (RecoveryControlConfiguration.Service service : node.services()) {
                String owner = target(node.id(), service.id());
                Set<String> declared = new HashSet<>();
                for (RecoveryControlConfiguration.Dependency dependency : service.dependencies()) {
                    String candidate = target(dependency.nodeId(), dependency.serviceId());
                    if (owner.equals(candidate)) {
                        throw new IllegalArgumentException("Recovery service " + owner + " cannot depend on itself");
                    }
                    if (!targets.contains(candidate)) {
                        throw new IllegalArgumentException("Recovery service " + owner + " references unknown dependency " + candidate);
                    }
                    if (!declared.add(candidate)) {
                        throw new IllegalArgumentException("Recovery service " + owner + " declares duplicate dependency " + candidate);
                    }
                }
            }
        }
        for (String target : targets) {
            visit(target, configuration, new HashSet<>(), new HashSet<>());
        }
    }

    private static void visit(
            String current,
            RecoveryControlConfiguration configuration,
            Set<String> visiting,
            Set<String> visited
    ) {
        if (visited.contains(current)) {
            return;
        }
        if (!visiting.add(current)) {
            throw new IllegalArgumentException("Recovery dependency cycle detected at " + current);
        }
        RecoveryControlConfiguration.Service service = service(configuration, current);
        for (RecoveryControlConfiguration.Dependency dependency : service.dependencies()) {
            visit(target(dependency.nodeId(), dependency.serviceId()), configuration, visiting, visited);
        }
        visiting.remove(current);
        visited.add(current);
    }

    private static RecoveryControlConfiguration.Service service(
            RecoveryControlConfiguration configuration,
            String target
    ) {
        for (RecoveryControlConfiguration.Node node : configuration.nodes()) {
            for (RecoveryControlConfiguration.Service service : node.services()) {
                if (target(node.id(), service.id()).equals(target)) {
                    return service;
                }
            }
        }
        throw new IllegalArgumentException("Unknown Recovery target " + target);
    }

    private static URI loopbackUri(String raw, String label) {
        URI uri;
        try {
            uri = URI.create(raw);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException(label + " must be a valid loopback HTTP URL", exception);
        }
        String host = uri.getHost();
        boolean loopback = host != null && (
                "localhost".equalsIgnoreCase(host)
                        || "127.0.0.1".equals(host)
                        || "::1".equals(host)
        );
        if (!"http".equalsIgnoreCase(uri.getScheme()) || !loopback) {
            throw new IllegalArgumentException(label + " must use plaintext HTTP on localhost, 127.0.0.1, or ::1");
        }
        if (uri.getUserInfo() != null) {
            throw new IllegalArgumentException(label + " must not contain embedded credentials");
        }
        return uri;
    }

    private static JsonNode requireObject(JsonNode value, String label) {
        if (value == null || !value.isObject()) {
            throw new IllegalArgumentException(label + " must be an object");
        }
        return value;
    }

    private static String requiredText(JsonNode object, String field) {
        JsonNode value = object.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) {
            throw new IllegalArgumentException(field + " must be a non-blank string");
        }
        return value.textValue().trim();
    }

    private static String optionalText(JsonNode object, String field, String defaultValue) {
        JsonNode value = object.get(field);
        if (value == null || value.isNull()) {
            return defaultValue;
        }
        if (!value.isTextual() || value.textValue().isBlank()) {
            throw new IllegalArgumentException(field + " must be a non-blank string when provided");
        }
        return value.textValue().trim();
    }

    private static boolean requiredBoolean(JsonNode object, String field) {
        JsonNode value = object.get(field);
        if (value == null || !value.isBoolean()) {
            throw new IllegalArgumentException(field + " must be boolean");
        }
        return value.booleanValue();
    }

    private static boolean booleanOrDefault(JsonNode object, String field, boolean defaultValue) {
        JsonNode value = object.get(field);
        if (value == null || value.isNull()) {
            return defaultValue;
        }
        if (!value.isBoolean()) {
            throw new IllegalArgumentException(field + " must be boolean when provided");
        }
        return value.booleanValue();
    }

    private static int nonNegativeInteger(JsonNode object, String field) {
        JsonNode value = object.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < 0) {
            throw new IllegalArgumentException(field + " must be a non-negative integer");
        }
        return value.intValue();
    }

    private static int positiveIntegerOrDefault(JsonNode object, String field, int defaultValue) {
        JsonNode value = object.get(field);
        if (value == null || value.isNull()) {
            return defaultValue;
        }
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() <= 0) {
            throw new IllegalArgumentException(field + " must be a positive integer when provided");
        }
        return value.intValue();
    }

    private static String target(String nodeId, String serviceId) {
        return nodeId + "/" + serviceId;
    }
}
