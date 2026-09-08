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
            assertEquals(2, empty.snapshot().get("schemaVersion").intValue());

            ObjectNode firstSnapshot = snapshotV2();
            firstSnapshot.withArray("audit").addObject().put("id", "event-1");
            RecoveryStateLoadResult first = authority.commit(0, firstSnapshot);
            assertEquals(1, first.revision());
            assertEquals(1, authority.load().revision());

            ObjectNode secondSnapshot = firstSnapshot.deepCopy();
            secondSnapshot.withArray("audit").addObject().put("id", "event-2");
            RecoveryStateLoadResult second = authority.commit(1, secondSnapshot);
            assertEquals(2, second.revision());
            assertEquals(2, authority.load().revision());

            RecoveryStateStaleRevisionException stale = assertThrows(RecoveryStateStaleRevisionException.class, () -> authority.commit(1, secondSnapshot));
            assertEquals(1, stale.getExpectedRevision());
            assertEquals(2, stale.getActualRevision());
        }
    }

    @Test
    void migratesLegacyV1SnapshotBeforePersistenceAndReturn() {
        try (RecoveryStateAuthority authority = newAuthority()) {
            ObjectNode legacy = snapshotV1();
            legacy.withArray("audit").addObject().put("id", "legacy-event");
            RecoveryStateLoadResult committed = authority.commit(0, legacy);
            assertEquals(2, committed.snapshot().path("schemaVersion").intValue());
            assertTrue(committed.snapshot().path("nodeHealthIncidents").isArray());
            assertTrue(committed.snapshot().path("certificateIncidents").isArray());
            assertTrue(committed.snapshot().path("deploymentStates").isArray());
            assertTrue(committed.snapshot().path("deploymentIncidents").isArray());
            RecoveryStateLoadResult loaded = authority.load();
            assertEquals(2, loaded.snapshot().path("schemaVersion").intValue());
            assertEquals("legacy-event", loaded.snapshot().path("audit").get(0).path("id").textValue());
        }
    }

    @Test
    void persistsSecondaryRecoveryWatchState() {
        try (RecoveryStateAuthority authority = newAuthority()) {
            ObjectNode snapshot = snapshotV2();
            snapshot.withArray("nodeHealthIncidents").addObject().put("id", "node-incident");
            snapshot.withArray("certificateIncidents").addObject().put("id", "certificate-incident");
            snapshot.withArray("deploymentStates").addObject().put("nodeId", "east").put("serviceId", "payments");
            snapshot.withArray("deploymentIncidents").addObject().put("id", "deployment-incident");
            RecoveryStateLoadResult committed = authority.commit(0, snapshot);
            assertEquals(1, committed.snapshot().path("nodeHealthIncidents").size());
            assertEquals(1, committed.snapshot().path("certificateIncidents").size());
            assertEquals(1, committed.snapshot().path("deploymentStates").size());
            assertEquals(1, committed.snapshot().path("deploymentIncidents").size());
        }
    }

    @Test
    void refusesAuditHistoryRewrites() {
        try (RecoveryStateAuthority authority = newAuthority()) {
            ObjectNode firstSnapshot = snapshotV2(); firstSnapshot.withArray("audit").addObject().put("id", "event-1").put("message", "original"); authority.commit(0, firstSnapshot);
            ObjectNode rewritten = firstSnapshot.deepCopy(); ((ObjectNode) rewritten.withArray("audit").get(0)).put("message", "rewritten");
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> authority.commit(1, rewritten)); assertTrue(error.getMessage().contains("immutable"));
        }
    }

    @Test
    void protocolRejectsUnknownFieldsAndReportsStaleRevision() {
        try (RecoveryStateAuthority authority = newAuthority()) {
            RecoveryStateProtocolHandler protocol = new RecoveryStateProtocolHandler(authority, objectMapper);
            ObjectNode invalid = objectMapper.createObjectNode(); invalid.put("id", "one"); invalid.put("operation", "load"); invalid.put("surprise", true);
            ObjectNode invalidResponse = protocol.handle(invalid); assertEquals(false, invalidResponse.get("ok").booleanValue()); assertEquals("invalid_request", invalidResponse.path("error").path("code").textValue());

            ObjectNode commit = objectMapper.createObjectNode(); commit.put("id", "two"); commit.put("operation", "commit"); commit.put("expectedRevision", 0); commit.set("snapshot", snapshotV2());
            assertEquals(1, protocol.handle(commit).get("revision").longValue());
            ObjectNode stale = commit.deepCopy(); stale.put("id", "three"); ObjectNode staleResponse = protocol.handle(stale);
            assertEquals(false, staleResponse.get("ok").booleanValue()); assertEquals("stale_revision", staleResponse.path("error").path("code").textValue()); assertEquals(1, staleResponse.get("actualRevision").longValue());
        }
    }

    private RecoveryStateAuthority newAuthority() {
        String jdbcUrl = "jdbc:h2:mem:recovery_state_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        IPostgresDatabase database = PostgresDatabaseBuilder.create().jdbcUrl(jdbcUrl).username("sa").password("").entityPackage("org.tavall.recovery.state").generateSchema(true).showSql(false).build().orElseThrow();
        return new RecoveryStateAuthority(database, objectMapper);
    }

    private ObjectNode snapshotV1() {
        ObjectNode snapshot = objectMapper.createObjectNode(); snapshot.put("schemaVersion", 1); snapshot.putArray("incidents"); snapshot.putArray("plans"); snapshot.putArray("semanticWatches"); snapshot.putArray("restartAttempts"); snapshot.putArray("audit"); return snapshot;
    }

    private ObjectNode snapshotV2() {
        ObjectNode snapshot = objectMapper.createObjectNode(); snapshot.put("schemaVersion", 2); snapshot.putArray("incidents"); snapshot.putArray("plans"); snapshot.putArray("semanticWatches"); snapshot.putArray("restartAttempts"); snapshot.putArray("nodeHealthIncidents"); snapshot.putArray("certificateIncidents"); snapshot.putArray("deploymentStates"); snapshot.putArray("deploymentIncidents"); snapshot.putArray("audit"); return snapshot;
    }
}
