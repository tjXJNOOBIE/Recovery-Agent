package org.tavall.recovery.state;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.tavall.database.postgres.IPostgresDatabase;
import org.tavall.database.postgres.PostgresDatabaseBuilder;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

public final class RecoveryStateAuthorityMain {
    private RecoveryStateAuthorityMain() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 0) {
            throw new IllegalArgumentException("Recovery state authority accepts configuration through environment variables only");
        }

        ObjectMapper objectMapper = new ObjectMapper();
        IPostgresDatabase database = buildDatabase();
        try (RecoveryStateAuthority authority = new RecoveryStateAuthority(database, objectMapper);
             BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
             BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8))) {
            RecoveryStateProtocolHandler protocol = new RecoveryStateProtocolHandler(authority, objectMapper);
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) continue;
                ObjectNode response;
                try {
                    JsonNode request = objectMapper.readTree(line);
                    response = protocol.handle(request);
                } catch (JsonProcessingException exception) {
                    response = objectMapper.createObjectNode();
                    response.putNull("id");
                    response.put("ok", false);
                    ObjectNode error = response.putObject("error");
                    error.put("code", "invalid_json");
                    error.put("message", "Recovery state request is not valid JSON");
                }
                writer.write(objectMapper.writeValueAsString(response));
                writer.newLine();
                writer.flush();
            }
        }
    }

    private static IPostgresDatabase buildDatabase() {
        String jdbcUrl = requireEnvironment("RECOVERY_STATE_JDBC_URL");
        String username = optionalEnvironment("RECOVERY_STATE_DB_USERNAME");
        String password = optionalEnvironment("RECOVERY_STATE_DB_PASSWORD");
        boolean generateSchema = Boolean.parseBoolean(optionalEnvironment("RECOVERY_STATE_GENERATE_SCHEMA"));

        return PostgresDatabaseBuilder.create()
                .jdbcUrl(jdbcUrl)
                .username(username)
                .password(password)
                .readOnly(false)
                .entityPackage("org.tavall.recovery.state")
                .generateSchema(generateSchema)
                .showSql(false)
                .build()
                .orElseThrow(() -> new IllegalStateException("Unable to initialize Recovery state PostgreSQL authority"));
    }

    private static String requireEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must be configured");
        }
        return value.trim();
    }

    private static String optionalEnvironment(String name) {
        String value = System.getenv(name);
        return value == null ? "" : value;
    }
}
