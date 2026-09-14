package org.tavall.recovery.state;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.tavall.database.postgres.IPostgresDatabase;
import org.tavall.database.postgres.PostgresDatabaseBuilder;

import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/** Builds the durable Recovery state authority for in-process product ownership or legacy compatibility. */
public final class RecoveryStateAuthorityBuilder {
    private final Map<String, String> environment;
    private final ObjectMapper objectMapper;

    public RecoveryStateAuthorityBuilder(Map<String, String> environment, ObjectMapper objectMapper) {
        this.environment = Map.copyOf(Objects.requireNonNull(environment, "environment"));
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public Optional<RecoveryStateAuthority> buildIfConfigured() {
        String jdbcUrl = optional("RECOVERY_STATE_JDBC_URL");
        if (jdbcUrl == null) {
            return Optional.empty();
        }
        return Optional.of(build(jdbcUrl));
    }

    public RecoveryStateAuthority buildRequired() {
        String jdbcUrl = optional("RECOVERY_STATE_JDBC_URL");
        if (jdbcUrl == null) {
            throw new IllegalArgumentException("RECOVERY_STATE_JDBC_URL must be configured");
        }
        return build(jdbcUrl);
    }

    private RecoveryStateAuthority build(String jdbcUrl) {
        IPostgresDatabase database = PostgresDatabaseBuilder.create()
                .jdbcUrl(jdbcUrl)
                .username(optionalOrEmpty("RECOVERY_STATE_DB_USERNAME"))
                .password(optionalOrEmpty("RECOVERY_STATE_DB_PASSWORD"))
                .readOnly(false)
                .entityPackage("org.tavall.recovery.state")
                .generateSchema(Boolean.parseBoolean(optionalOrEmpty("RECOVERY_STATE_GENERATE_SCHEMA")))
                .showSql(false)
                .build()
                .orElseThrow(() -> new IllegalStateException("Unable to initialize Recovery state PostgreSQL authority"));
        return new RecoveryStateAuthority(database, objectMapper);
    }

    private String optionalOrEmpty(String name) {
        String value = optional(name);
        return value == null ? "" : value;
    }

    private String optional(String name) {
        String value = environment.get(name);
        return value == null || value.isBlank() ? null : value.trim();
    }
}
