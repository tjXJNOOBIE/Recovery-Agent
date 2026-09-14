package org.tavall.recovery.runtime;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Public, read-only readiness projection for the Java Recovery HTTP runtime. */
public final class RecoveryStatusServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_OK);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType("application/json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.getWriter().write(
                "{\"status\":\"ok\",\"name\":\"Recovery Agent\",\"version\":\"0.2.0\",\"mcp\":\"/mcp\"}"
        );
    }
}
