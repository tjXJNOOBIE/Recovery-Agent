package org.tavall.recovery.state;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.tavall.database.postgres.IPostgresDatabase;
import org.tavall.database.postgres.PostgresDatabaseBuilder;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RecoveryStateAuthorityTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void persistsMonotonicRevisionsAndRejectsStaleCommits() {
        try (RecoveryStateAuthority authority = newAuthority()) {
            RecoveryStateLoadResult empty = authority.load();
            assertEquals(0, empty.revision());
            assertEquals(1, empty.snapshot().get("schemaVersion").intValue());

            ObjectNode firstSnapshot = snapshot();
            firstSnapshot.withArray("audit").addObject().put("id", "event-1");
            RecoveryStateLoadResult first = authority.commit(0, firstSnapshot);
            assertEquals(1, first.revision());
            assertEquals(1, authority.load().revision());

            ObjectNode secondSnapshot = firstSnapshot.deepCopy();
            secondSnapshot.withArray("audit").addObject().put("id", "event-2");
            RecoveryStateLoadResult second = authority.commit(1, secondSnapshot);
            assertEquals(2, second.revision());
            assertEquals(2, authority.load().revision());

            RecoveryStateStaleRevisionException stale = assertThrows(
                    RecoveryStateStaleRevisionException.class,
                    () -> authority.commit(1, secondSnapshot)
            );
            assertEquals(1, stale.getExpectedRevision());
            assertEquals(2, stale.getActualRevision());
        }
    }

    @Test
    void refusesAuditHistoryRewrites() {
        try (RecoveryStateAuthority authority = newAuthority()) {
            ObjectNode firstSnapshot = snapshot();
            firstSnapshot.withArray("audit").addObject().put("id", "event-1").put("message", "original");
            authority.commit(0, firstSnapshot);

            ObjectNode rewritten = firstSnapshot.deepCopy();
            ((ObjectNode) rewritten.withArray("audit").get(0)).put("message", "rewritten");
            IllegalArgumentException error = assertThrows(
                    IllegalArgumentException.class,
                    () -> authority.commit(1, rewritten)
            );
            assertTrue(error.getMessage().contains("immutable"));
        }
    }

    @Test
    void protocolRejectsUnknownFieldsAndReportsStaleRevision() {
        try (RecoveryStateAuthority authority = newAuthority()) {
            RecoveryStateProtocolHandler protocol = new RecoveryStateProtocolHandler(authority, objectMapper);

            ObjectNode invalid = objectMapper.createObjectNode();
            invalid.put("id", "one");
            invalid.put("operation", "load");
            invalid.put("surprise", true);
            ObjectNode invalidResponse = protocol.handle(invalid);
            assertEquals(false, invalidResponse.get("ok").booleanValue());
            assertEquals("invalid_request", invalidResponse.path("error").path("code").textValue());

            ObjectNode commit = objectMapper.createObjectNode();
            commit.put("id", "two");
            commit.put("operation", "commit");
            commit.put("expectedRevision", 0);
            commit.set("snapshot", snapshot());
            assertEquals(1, protocol.handle(commit).get("revision").longValue());

            ObjectNode stale = commit.deepCopy();
            stale.put("id", "three");
            ObjectNode staleResponse = protocol.handle(stale);
            assertEquals(false, staleResponse.get("ok").booleanValue());
            assertEquals("stale_revision", staleResponse.path("error").path("code").textValue());
            assertEquals(1, staleResponse.get("actualRevision").longValue());
        }
    }

    private RecoveryStateAuthority newAuthority() {
        String jdbcUrl = "jdbc:h2:mem:recovery_state_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        IPostgresDatabase database = PostgresDatabaseBuilder.create()
                .jdbcUrl(jdbcUrl)
                .username("sa")
                .password("")
                .entityPackage("org.tavall.recovery.state")
                .generateSchema(true)
                .showSql(false)
                .build()
                .orElseThrow();
        return new RecoveryStateAuthority(database, objectMapper);
    }

    private ObjectNode snapshot() {
        ObjectNode snapshot = objectMapper.createObjectNode();
        snapshot.put("schemaVersion", 1);
        snapshot.putArray("incidents");
        snapshot.putArray("plans");
        snapshot.putArray("semanticWatches");
        snapshot.putArray("restartAttempts");
        snapshot.putArray("audit");
        return snapshot;
    }
}
