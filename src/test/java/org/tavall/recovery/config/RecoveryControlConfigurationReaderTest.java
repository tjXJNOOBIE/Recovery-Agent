package org.tavall.recovery.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RecoveryControlConfigurationReaderTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RecoveryControlConfigurationReader reader = new RecoveryControlConfigurationReader(objectMapper);

    @Test
    void validLoopbackTopologyPreservesRecoveryPolicyConfiguration() throws Exception {
        RecoveryControlConfiguration configuration = reader.read(objectMapper.readTree("""
                {
                  "transport": { "mode": "loopback_http" },
                  "nodes": [
                    {
                      "id": "east",
                      "baseUrl": "http://127.0.0.1:7844/",
                      "tokenEnvironmentVariable": "RECOVERY_EAST_TOKEN",
                      "services": [
                        {
                          "id": "database",
                          "restartAllowed": false,
                          "maxRestartAttempts": 0
                        },
                        {
                          "id": "api",
                          "restartAllowed": true,
                          "maxRestartAttempts": 2,
                          "dependencies": [{ "serviceId": "database" }]
                        }
                      ]
                    }
                  ]
                }
                """));

        assertThat(configuration.transport().isLoopbackHttp()).isTrue();
        assertThat(configuration.nodes()).hasSize(1);
        assertThat(configuration.nodes().getFirst().services()).hasSize(2);
        RecoveryControlConfiguration.Service api = configuration.nodes().getFirst().services().get(1);
        assertThat(api.restartBudgetWindowSeconds()).isEqualTo(600);
        assertThat(api.watchEnabled()).isTrue();
        assertThat(api.watchIntervalSeconds()).isEqualTo(30);
        assertThat(api.dependencies()).containsExactly(
                new RecoveryControlConfiguration.Dependency("east", "database")
        );
    }

    @Test
    void remotePlaintextNodeEndpointIsRejected() throws Exception {
        assertThatThrownBy(() -> reader.read(objectMapper.readTree("""
                {
                  "nodes": [{
                    "id": "east",
                    "baseUrl": "http://example.com:7844/",
                    "tokenEnvironmentVariable": "RECOVERY_EAST_TOKEN",
                    "services": [{ "id": "api", "restartAllowed": true, "maxRestartAttempts": 1 }]
                  }]
                }
                """)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("plaintext HTTP on localhost");
    }

    @Test
    void dependencyCycleIsRejectedBeforeRuntimeComposition() throws Exception {
        assertThatThrownBy(() -> reader.read(objectMapper.readTree("""
                {
                  "nodes": [{
                    "id": "east",
                    "baseUrl": "http://localhost:7844/",
                    "tokenEnvironmentVariable": "RECOVERY_EAST_TOKEN",
                    "services": [
                      {
                        "id": "api",
                        "restartAllowed": true,
                        "maxRestartAttempts": 1,
                        "dependencies": [{ "serviceId": "worker" }]
                      },
                      {
                        "id": "worker",
                        "restartAllowed": true,
                        "maxRestartAttempts": 1,
                        "dependencies": [{ "serviceId": "api" }]
                      }
                    ]
                  }]
                }
                """)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("dependency cycle");
    }
}
