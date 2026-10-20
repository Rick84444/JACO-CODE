package ai.jaco.nativeengine

import kotlinx.serialization.json.*

internal data class NativePrompt(val system: String?, val user: String)

/** Only single-turn LiteRT conversations are supported; reject unsupported roles. */
internal fun parseNativePrompt(request: JsonObject): NativePrompt {
    val messages = request["messages"] as? JsonArray
        ?: throw IllegalArgumentException("NATIVE_CHAT_MESSAGES_REQUIRED")
    require(messages.isNotEmpty() && messages.size <= 2) { "NATIVE_CHAT_HISTORY_UNSUPPORTED" }
    var system: String? = null
    var user: String? = null
    messages.forEachIndexed { index, element ->
        val message = element as? JsonObject ?: throw IllegalArgumentException("NATIVE_CHAT_MESSAGE_INVALID")
        val role = (message["role"] as? JsonPrimitive)?.contentOrNull
            ?: throw IllegalArgumentException("NATIVE_CHAT_ROLE_INVALID")
        val content = (message["content"] as? JsonPrimitive)?.contentOrNull
            ?: throw IllegalArgumentException("NATIVE_CHAT_CONTENT_INVALID")
        when (role) {
            "system" -> {
                require(index == 0 && system == null && user == null) { "NATIVE_CHAT_ROLE_ORDER_INVALID" }
                system = content
            }
            "user" -> {
                require(user == null && content.isNotBlank()) { "NATIVE_CHAT_USER_INVALID" }
                user = content
            }
            else -> throw IllegalArgumentException("NATIVE_CHAT_ROLE_UNSUPPORTED:$role")
        }
    }
    return NativePrompt(system?.takeIf { it.isNotBlank() },
        user ?: throw IllegalArgumentException("NATIVE_CHAT_USER_REQUIRED"))
}

/** Normalize OpenAI function tools and MCP inputSchema tools into LiteRT descriptors. */
internal fun normalizeNativeToolSpec(spec: JsonObject): String {
    val type = (spec["type"] as? JsonPrimitive)?.contentOrNull
    require(type == null || type == "function") { "NATIVE_TOOL_TYPE_UNSUPPORTED" }
    val descriptor = if (type == "function") {
        spec["function"] as? JsonObject ?: throw IllegalArgumentException("NATIVE_TOOL_FUNCTION_REQUIRED")
    } else spec
    val name = (descriptor["name"] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
    require(name.matches(Regex("[A-Za-z_][A-Za-z0-9_.-]{0,127}"))) { "NATIVE_TOOL_NAME_INVALID" }
    val description = (descriptor["description"] as? JsonPrimitive)?.contentOrNull ?: "JACO tool"
    val parameters = descriptor["parameters"] ?: descriptor["inputSchema"] ?: descriptor["input_schema"]
        ?: buildJsonObject { put("type", "object"); put("properties", buildJsonObject { }) }
    require(parameters is JsonObject) { "NATIVE_TOOL_SCHEMA_INVALID" }
    return buildJsonObject {
        put("name", name)
        put("description", description)
        put("parameters", parameters)
    }.toString()
}
