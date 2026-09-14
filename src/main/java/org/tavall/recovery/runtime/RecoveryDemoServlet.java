package org.tavall.recovery.runtime;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

/** Serves the loopback-only Recovery Agent product demo; Java MCP remains the authority. */
public final class RecoveryDemoServlet extends HttpServlet {
    private static final String DEMO_RESOURCE = "/recovery-agent/demo/index.html";
    private final String document;

    public RecoveryDemoServlet(String nodeId, String serviceId) {
        String safeNodeId = requireTarget(nodeId, "nodeId");
        String safeServiceId = requireTarget(serviceId, "serviceId");
        document = loadDocument()
                .replace("__RECOVERY_NODE_ID__", escapeJavaScript(safeNodeId))
                .replace("__RECOVERY_SERVICE_ID__", escapeJavaScript(safeServiceId));
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String path = request.getPathInfo();
        if (path != null && !path.isBlank() && !"/".equals(path)
                && !path.matches("/(incident|observe|policy|recover|verify|audit|mcp)")) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType("text/html; charset=UTF-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.getWriter().write(document);
    }

    private static String loadDocument() {
        try (InputStream input = RecoveryDemoServlet.class.getResourceAsStream(DEMO_RESOURCE)) {
            if (input == null) {
                throw new IllegalStateException("Recovery Agent demo site resource is missing: " + DEMO_RESOURCE);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to load Recovery Agent demo site", exception);
        }
    }

    private static String requireTarget(String value, String name) {
        String safe = Objects.requireNonNull(value, name).trim();
        if (safe.isBlank() || !safe.matches("[A-Za-z0-9._:-]+")) {
            throw new IllegalArgumentException(name + " must contain only bounded target characters");
        }
        return safe;
    }

    private static String escapeJavaScript(String value) {
        return value.replace("\\", "\\\\").replace("'", "\\'");
    }
}
