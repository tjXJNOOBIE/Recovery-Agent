package org.tavall.recovery.state;

public final class RecoveryStateStaleRevisionException extends RuntimeException {
    private final long expectedRevision;
    private final long actualRevision;

    public RecoveryStateStaleRevisionException(long expectedRevision, long actualRevision) {
        super("Recovery state revision is stale: expected " + expectedRevision + " but current is " + actualRevision);
        this.expectedRevision = expectedRevision;
        this.actualRevision = actualRevision;
    }

    public long getExpectedRevision() {
        return expectedRevision;
    }

    public long getActualRevision() {
        return actualRevision;
    }
}
