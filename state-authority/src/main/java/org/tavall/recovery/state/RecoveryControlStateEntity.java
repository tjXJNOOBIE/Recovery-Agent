package org.tavall.recovery.state;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

@Entity
@Table(name = "recovery_control_state")
public final class RecoveryControlStateEntity {
    @Id
    @Column(name = "state_id", nullable = false, length = 64)
    private String id;

    @Column(name = "durable_revision", nullable = false)
    private long revision;

    @Version
    @Column(name = "lock_version", nullable = false)
    private long lockVersion;

    @Lob
    @Column(name = "snapshot_json", nullable = false)
    private String snapshotJson;

    @Column(name = "updated_at", nullable = false, length = 64)
    private String updatedAt;

    protected RecoveryControlStateEntity() {
    }

    public RecoveryControlStateEntity(
            String id,
            long revision,
            long lockVersion,
            String snapshotJson,
            String updatedAt
    ) {
        this.id = id;
        this.revision = revision;
        this.lockVersion = lockVersion;
        this.snapshotJson = snapshotJson;
        this.updatedAt = updatedAt;
    }

    public String getId() {
        return id;
    }

    public long getRevision() {
        return revision;
    }

    public long getLockVersion() {
        return lockVersion;
    }

    public String getSnapshotJson() {
        return snapshotJson;
    }

    public String getUpdatedAt() {
        return updatedAt;
    }
}
