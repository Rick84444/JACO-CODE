package ai.jaco.nativeengine

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class NativeRequestValidationTest {
    private fun rejected(fragment: String, action: () -> Unit) {
        try { action(); fail("Expected rejection: $fragment") }
        catch (error: IllegalArgumentException) {
            assertTrue(error.message.orEmpty(), error.message.orEmpty().contains(fragment))
        }
    }

    @Test fun acceptsSystemAndSingleUserTurn() {
        val input = buildJsonObject {
            put("messages", buildJsonArray {
                add(buildJsonObject { put("role", "system"); put("content", "Be concise") })
                add(buildJsonObject { put("role", "user"); put("content", "Calculate 2 + 2") })
            })
        }
        assertEquals(NativePrompt("Be concise", "Calculate 2 + 2"), parseNativePrompt(input))
    }

    @Test fun rejectsSilentlyFlattenedConversationHistory() {
        rejected("HISTORY_UNSUPPORTED") {
            parseNativePrompt(buildJsonObject { put("messages", buildJsonArray {
                add(buildJsonObject { put("role", "user"); put("content", "first") })
                add(buildJsonObject { put("role", "assistant"); put("content", "reply") })
                add(buildJsonObject { put("role", "user"); put("content", "second") })
            }) })
        }
        rejected("ROLE_UNSUPPORTED") {
            parseNativePrompt(buildJsonObject { put("messages", buildJsonArray {
                add(buildJsonObject { put("role", "tool"); put("content", "untrusted") })
            }) })
        }
        rejected("ROLE_ORDER_INVALID") {
            parseNativePrompt(buildJsonObject { put("messages", buildJsonArray {
                add(buildJsonObject { put("role", "user"); put("content", "first") })
                add(buildJsonObject { put("role", "system"); put("content", "late") })
            }) })
        }
    }

    @Test fun acceptsBothMcpAndOpenAiFunctionFormats() {
        val schema = buildJsonObject { put("type", "object") }
        val openAi = buildJsonObject {
            put("type", "function")
            put("function", buildJsonObject {
                put("name", "calculate")
                put("description", "Runs calculator")
                put("parameters", schema)
            })
        }
        val mcp = buildJsonObject {
            put("name", "calculate")
            put("description", "Runs calculator")
            put("inputSchema", schema)
        }
        assertEquals(normalizeNativeToolSpec(openAi), normalizeNativeToolSpec(mcp))
        assertEquals(schema, Json.parseToJsonElement(normalizeNativeToolSpec(openAi)).jsonObject["parameters"])
    }

    @Test fun malformedToolDescriptorsAreRejected() {
        rejected("TYPE_UNSUPPORTED") {
            normalizeNativeToolSpec(buildJsonObject { put("type", "webhook"); put("name", "tool") })
        }
        rejected("NAME_INVALID") {
            normalizeNativeToolSpec(buildJsonObject { put("name", "bad name") })
        }
        rejected("SCHEMA_INVALID") {
            normalizeNativeToolSpec(buildJsonObject { put("name", "valid"); put("parameters", "not an object") })
        }
    }
}
