package org.tavall.recovery.state;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/** Legacy compatibility launcher. New Java product code consumes {@link RecoveryStateAuthority} in-process. */
public final class RecoveryStateAuthorityMain {
    private RecoveryStateAuthorityMain() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 0) {
            throw new IllegalArgumentException("Recovery state authority accepts configuration through environment variables only");
        }

        ObjectMapper objectMapper = new ObjectMapper();
        try (RecoveryStateAuthority authority = new RecoveryStateAuthorityBuilder(System.getenv(), objectMapper).buildRequired();
             BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
             BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8))) {
            RecoveryStateProtocolHandler protocol = new RecoveryStateProtocolHandler(authority, objectMapper);
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
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
}
