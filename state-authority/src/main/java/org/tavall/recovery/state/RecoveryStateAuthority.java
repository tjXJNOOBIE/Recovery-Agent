package org.tavall.recovery.state;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.tavall.database.postgres.IPostgresDatabase;
import org.tavall.database.postgres.entity.IPostgresEntityStore;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

public final class RecoveryStateAuthority implements AutoCloseable {
    private static final String STATE_ID = "control";
    private static final int SCHEMA_VERSION = 1;

    private final IPostgresDatabase database;
    private final IPostgresEntityStore entities;
    private final ObjectMapper objectMapper;

    public RecoveryStateAuthority(IPostgresDatabase database, ObjectMapper objectMapper) {
        this.database = Objects.requireNonNull(database, "database");
        this.entities = database.entities();
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    public boolean isAvailable() {
        return entities.isOpen() && database.isAvailable();
    }

    public synchronized RecoveryStateLoadResult load() {
        Optional<RecoveryControlStateEntity> current = entities.find(RecoveryControlStateEntity.class, STATE_ID);
        if (current.isEmpty()) {
            return new RecoveryStateLoadResult(0, emptySnapshot());
        }
        RecoveryControlStateEntity entity = current.get();
        return new RecoveryStateLoadResult(entity.getRevision(), parseSnapshot(entity.getSnapshotJson()));
    }

    public synchronized RecoveryStateLoadResult commit(long expectedRevision, JsonNode snapshot) {
        if (expectedRevision < 0) {
            throw new IllegalArgumentException("expectedRevision must be non-negative");
        }

        JsonNode normalized = validateSnapshot(snapshot);
        Optional<RecoveryControlStateEntity> current = entities.find(RecoveryControlStateEntity.class, STATE_ID);
        long actualRevision = current.map(RecoveryControlStateEntity::getRevision).orElse(0L);
        if (actualRevision != expectedRevision) {
            throw new RecoveryStateStaleRevisionException(expectedRevision, actualRevision);
        }

        if (current.isPresent()) {
            validateAuditAppend(parseSnapshot(current.get().getSnapshotJson()), normalized);
        }

        long lockVersion = current.map(RecoveryControlStateEntity::getLockVersion).orElse(0L);
        long nextRevision = Math.addExact(expectedRevision, 1L);
        RecoveryControlStateEntity candidate = new RecoveryControlStateEntity(
                STATE_ID,
                nextRevision,
                lockVersion,
                writeSnapshot(normalized),
                Instant.now().toString()
        );

        try {
            RecoveryControlStateEntity saved = entities.save(candidate);
            return new RecoveryStateLoadResult(saved.getRevision(), normalized.deepCopy());
        } catch (RuntimeException exception) {
            long latestRevision = entities.find(RecoveryControlStateEntity.class, STATE_ID)
                    .map(RecoveryControlStateEntity::getRevision)
                    .orElse(0L);
            if (latestRevision != expectedRevision) {
                throw new RecoveryStateStaleRevisionException(expectedRevision, latestRevision);
            }
            throw exception;
        }
    }

    @Override
    public void close() {
        database.close();
    }

    private JsonNode validateSnapshot(JsonNode snapshot) {
        if (snapshot == null || !snapshot.isObject()) {
            throw new IllegalArgumentException("Recovery durable snapshot must be a JSON object");
        }
        JsonNode schemaVersion = snapshot.get("schemaVersion");
        if (schemaVersion == null || !schemaVersion.isIntegralNumber() || schemaVersion.intValue() != SCHEMA_VERSION) {
            throw new IllegalArgumentException("Recovery durable snapshot schemaVersion must equal 1");
        }
        requireArray(snapshot, "incidents");
        requireArray(snapshot, "plans");
        requireArray(snapshot, "semanticWatches");
        requireArray(snapshot, "restartAttempts");
        requireArray(snapshot, "audit");
        return snapshot.deepCopy();
    }

    private void validateAuditAppend(JsonNode currentSnapshot, JsonNode nextSnapshot) {
        ArrayNode currentAudit = (ArrayNode) currentSnapshot.get("audit");
        ArrayNode nextAudit = (ArrayNode) nextSnapshot.get("audit");
        if (nextAudit.size() < currentAudit.size()) {
            throw new IllegalArgumentException("Recovery audit history is append-only and cannot shrink");
        }
        for (int index = 0; index < currentAudit.size(); index += 1) {
            if (!currentAudit.get(index).equals(nextAudit.get(index))) {
                throw new IllegalArgumentException("Recovery audit history is immutable and cannot rewrite existing entries");
            }
        }
    }

    private void requireArray(JsonNode snapshot, String field) {
        JsonNode value = snapshot.get(field);
        if (value == null || !value.isArray()) {
            throw new IllegalArgumentException("Recovery durable snapshot field " + field + " must be an array");
        }
    }

    private JsonNode parseSnapshot(String json) {
        try {
            return validateSnapshot(objectMapper.readTree(json));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Persisted Recovery durable snapshot is invalid JSON", exception);
        }
    }

    private String writeSnapshot(JsonNode snapshot) {
        try {
            return objectMapper.writeValueAsString(snapshot);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to serialize Recovery durable snapshot", exception);
        }
    }

    private ObjectNode emptySnapshot() {
        ObjectNode snapshot = objectMapper.createObjectNode();
        snapshot.put("schemaVersion", SCHEMA_VERSION);
        snapshot.putArray("incidents");
        snapshot.putArray("plans");
        snapshot.putArray("semanticWatches");
        snapshot.putArray("restartAttempts");
        snapshot.putArray("audit");
        return snapshot;
    }
}
