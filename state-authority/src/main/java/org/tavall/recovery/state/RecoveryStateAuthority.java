package org.tavall.recovery.state;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.tavall.database.postgres.IPostgresDatabase;
import org.tavall.database.postgres.entity.IPostgresEntityStore;

import java.time.Instant;
import java.util.HashSet;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

public final class RecoveryStateAuthority implements AutoCloseable {
    private static final String STATE_ID = "control";
    private static final int LEGACY_SCHEMA_VERSION = 1;
    private static final int SCHEMA_VERSION = 2;
    private static final Set<String> V1_FIELDS = Set.of("schemaVersion", "incidents", "plans", "semanticWatches", "restartAttempts", "audit");
    private static final Set<String> V2_FIELDS = Set.of("schemaVersion", "incidents", "plans", "semanticWatches", "restartAttempts", "nodeHealthIncidents", "certificateIncidents", "deploymentStates", "deploymentIncidents", "audit");

    private final IPostgresDatabase database;
    private final IPostgresEntityStore entities;
    private final ObjectMapper objectMapper;

    public RecoveryStateAuthority(IPostgresDatabase database, ObjectMapper objectMapper) {
        this.database = Objects.requireNonNull(database, "database");
        this.entities = database.entities();
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public boolean isAvailable() { return entities.isOpen() && database.isAvailable(); }

    public synchronized RecoveryStateLoadResult load() {
        Optional<RecoveryControlStateEntity> current = entities.find(RecoveryControlStateEntity.class, STATE_ID);
        if (current.isEmpty()) return new RecoveryStateLoadResult(0, emptySnapshot());
        RecoveryControlStateEntity entity = current.get();
        return new RecoveryStateLoadResult(entity.getRevision(), parseSnapshot(entity.getSnapshotJson()));
    }

    public synchronized RecoveryStateLoadResult commit(long expectedRevision, JsonNode snapshot) {
        if (expectedRevision < 0) throw new IllegalArgumentException("expectedRevision must be non-negative");
        JsonNode normalized = normalizeSnapshot(snapshot);
        Optional<RecoveryControlStateEntity> current = entities.find(RecoveryControlStateEntity.class, STATE_ID);
        long actualRevision = current.map(RecoveryControlStateEntity::getRevision).orElse(0L);
        if (actualRevision != expectedRevision) throw new RecoveryStateStaleRevisionException(expectedRevision, actualRevision);
        if (current.isPresent()) validateAuditAppend(parseSnapshot(current.get().getSnapshotJson()), normalized);

        long lockVersion = current.map(RecoveryControlStateEntity::getLockVersion).orElse(0L);
        long nextRevision = Math.addExact(expectedRevision, 1L);
        RecoveryControlStateEntity candidate = new RecoveryControlStateEntity(STATE_ID, nextRevision, lockVersion, writeSnapshot(normalized), Instant.now().toString());
        try {
            RecoveryControlStateEntity saved = entities.save(candidate);
            return new RecoveryStateLoadResult(saved.getRevision(), normalized.deepCopy());
        } catch (RuntimeException exception) {
            long latestRevision = entities.find(RecoveryControlStateEntity.class, STATE_ID).map(RecoveryControlStateEntity::getRevision).orElse(0L);
            if (latestRevision != expectedRevision) throw new RecoveryStateStaleRevisionException(expectedRevision, latestRevision);
            throw exception;
        }
    }

    @Override public void close() { database.close(); }

    private JsonNode normalizeSnapshot(JsonNode snapshot) {
        if (snapshot == null || !snapshot.isObject()) throw new IllegalArgumentException("Recovery durable snapshot must be a JSON object");
        JsonNode schemaVersion = snapshot.get("schemaVersion");
        if (schemaVersion == null || !schemaVersion.isIntegralNumber()) throw new IllegalArgumentException("Recovery durable snapshot schemaVersion must be an integer");
        int version = schemaVersion.intValue();
        if (version == LEGACY_SCHEMA_VERSION) return migrateV1(snapshot);
        if (version != SCHEMA_VERSION) throw new IllegalArgumentException("Recovery durable snapshot schemaVersion must equal 1 or 2");
        validateV2(snapshot);
        return snapshot.deepCopy();
    }

    private JsonNode migrateV1(JsonNode snapshot) {
        requireExactFields(snapshot, V1_FIELDS);
        requireArray(snapshot, "incidents"); requireArray(snapshot, "plans"); requireArray(snapshot, "semanticWatches"); requireArray(snapshot, "restartAttempts"); requireArray(snapshot, "audit");
        ObjectNode migrated = ((ObjectNode) snapshot).deepCopy();
        migrated.put("schemaVersion", SCHEMA_VERSION);
        migrated.putArray("nodeHealthIncidents");
        migrated.putArray("certificateIncidents");
        migrated.putArray("deploymentStates");
        migrated.putArray("deploymentIncidents");
        validateV2(migrated);
        return migrated;
    }

    private void validateV2(JsonNode snapshot) {
        requireExactFields(snapshot, V2_FIELDS);
        for (String field : Set.of("incidents", "plans", "semanticWatches", "restartAttempts", "nodeHealthIncidents", "certificateIncidents", "deploymentStates", "deploymentIncidents", "audit")) requireArray(snapshot, field);
    }

    private void validateAuditAppend(JsonNode currentSnapshot, JsonNode nextSnapshot) {
        ArrayNode currentAudit = (ArrayNode) currentSnapshot.get("audit"); ArrayNode nextAudit = (ArrayNode) nextSnapshot.get("audit");
        if (nextAudit.size() < currentAudit.size()) throw new IllegalArgumentException("Recovery audit history is append-only and cannot shrink");
        for (int index = 0; index < currentAudit.size(); index += 1) if (!currentAudit.get(index).equals(nextAudit.get(index))) throw new IllegalArgumentException("Recovery audit history is immutable and cannot rewrite existing entries");
    }

    private void requireExactFields(JsonNode snapshot, Set<String> expected) {
        Set<String> actual = new HashSet<>(); snapshot.fieldNames().forEachRemaining(actual::add);
        if (!actual.equals(expected)) throw new IllegalArgumentException("Recovery durable snapshot contains unexpected or missing fields");
    }

    private void requireArray(JsonNode snapshot, String field) { JsonNode value = snapshot.get(field); if (value == null || !value.isArray()) throw new IllegalArgumentException("Recovery durable snapshot field " + field + " must be an array"); }

    private JsonNode parseSnapshot(String json) {
        try { return normalizeSnapshot(objectMapper.readTree(json)); }
        catch (JsonProcessingException exception) { throw new IllegalStateException("Persisted Recovery durable snapshot is invalid JSON", exception); }
    }

    private String writeSnapshot(JsonNode snapshot) {
        try { return objectMapper.writeValueAsString(snapshot); }
        catch (JsonProcessingException exception) { throw new IllegalStateException("Unable to serialize Recovery durable snapshot", exception); }
    }

    private ObjectNode emptySnapshot() {
        ObjectNode snapshot = objectMapper.createObjectNode(); snapshot.put("schemaVersion", SCHEMA_VERSION);
        snapshot.putArray("incidents"); snapshot.putArray("plans"); snapshot.putArray("semanticWatches"); snapshot.putArray("restartAttempts");
        snapshot.putArray("nodeHealthIncidents"); snapshot.putArray("certificateIncidents"); snapshot.putArray("deploymentStates"); snapshot.putArray("deploymentIncidents"); snapshot.putArray("audit");
        return snapshot;
    }
}
