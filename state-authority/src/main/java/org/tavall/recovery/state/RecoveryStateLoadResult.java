package org.tavall.recovery.state;

import com.fasterxml.jackson.databind.JsonNode;

public record RecoveryStateLoadResult(long revision, JsonNode snapshot) {
}
