package ai.jaco.nativeengine

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.*
import kotlin.coroutines.resume

class HandsOffController(private val context: Context) {
    fun status(): JsonObject {
        val service = HandsOffAccessibilityService.instance
        val grant = HandsOffPolicyStore.get(context)
        return buildJsonObject {
            put("enabled", grant.isActive())
            put("accessibility_connected", service != null)
            put("active_package", service?.currentPackage() ?: "")
            put("grant", HandsOffPolicyStore.toJson(grant))
            put("reality", if (service != null && grant.isActive()) "OBSERVED" else "UNAVAILABLE")
        }
    }

    fun configure(params: JsonObject): JsonObject {
        val grant = params["grant"]?.jsonObject ?: error("grant is required")
        val stored = HandsOffPolicyStore.configure(context, grant)
        return buildJsonObject { put("success", true); put("grant", HandsOffPolicyStore.toJson(stored)); put("accessibility_connected", HandsOffAccessibilityService.instance != null) }
    }

    suspend fun action(params: JsonObject): JsonObject {
        val action = params["action"]?.jsonObject ?: error("action is required")
        val actionId = action["action_id"]?.jsonPrimitive?.contentOrNull ?: error("action_id is required")
        val type = action["type"]?.jsonPrimitive?.contentOrNull ?: error("action type is required")
        val grant = HandsOffPolicyStore.get(context)
        require(grant.isActive()) { "hands-off grant is disabled or expired" }
        val requestedPackage = action["package_name"]?.jsonPrimitive?.contentOrNull
        if (!requestedPackage.isNullOrBlank()) require(requestedPackage in grant.allowedPackages) { "requested package is not allowlisted" }
        val service = HandsOffAccessibilityService.instance ?: error("Accessibility Service is not connected")
        requireHandsOffTargetAllowed(type, grant.allowedPackages, requestedPackage, service.currentPackage())
        val result = when (type) {
            "observe_screen" -> service.observe()
            "open_app" -> {
                val packageName = requestedPackage ?: error("package_name is required")
                val launch = context.packageManager.getLaunchIntentForPackage(packageName) ?: error("package has no launch intent")
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); context.startActivity(launch)
                buildJsonObject { put("success", true); put("package_name", packageName) }
            }
            "run_intent" -> {
                val packageName = requestedPackage ?: error("package_name is required")
                val actionName = action["intent_action"]?.jsonPrimitive?.contentOrNull ?: "android.intent.action.VIEW"
                require(actionName == Intent.ACTION_VIEW) { "only android.intent.action.VIEW is allowed" }
                val uri = Uri.parse(action["intent_uri"]?.jsonPrimitive?.contentOrNull ?: error("intent_uri is required"))
                require(uri.scheme == "https" || (uri.scheme == "http" && (uri.host == "127.0.0.1" || uri.host == "localhost"))) { "intent URI must use HTTPS or local HTTP" }
                context.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                buildJsonObject { put("success", true); put("package_name", packageName); put("uri", uri.toString()) }
            }
            "tap" -> {
                require(grant.allowGestures) { "gesture grant is disabled" }
                val selector = action["selector"]?.jsonObject
                val x = action["x"]?.jsonPrimitive?.floatOrNull
                val y = action["y"]?.jsonPrimitive?.floatOrNull
                val success = suspendCancellableCoroutine<Boolean> { continuation -> service.click(selector, x, y) { if (continuation.isActive) continuation.resume(it) } }
                buildJsonObject { put("success", success) }
            }
            "type_text" -> {
                require(grant.allowTyping) { "typing grant is disabled" }
                val text = action["text"]?.jsonPrimitive?.contentOrNull ?: error("text is required")
                require(text.length <= 100_000) { "text exceeds 100000 character limit" }
                buildJsonObject { put("success", service.typeText(action["selector"]?.jsonObject, text)); put("characters", text.length) }
            }
            "scroll" -> {
                require(grant.allowGestures) { "gesture grant is disabled" }
                val direction = action["direction"]?.jsonPrimitive?.contentOrNull ?: "DOWN"
                require(direction in setOf("UP", "DOWN", "LEFT", "RIGHT")) { "invalid scroll direction" }
                buildJsonObject { put("success", service.scroll(direction, action["selector"]?.jsonObject)); put("direction", direction) }
            }
            "back" -> {
                require(grant.allowNavigation) { "navigation grant is disabled" }
                buildJsonObject { put("success", service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)) }
            }
            "home" -> {
                require(grant.allowNavigation) { "navigation grant is disabled" }
                buildJsonObject { put("success", service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)) }
            }
            else -> error("unknown hands-off action $type")
        }
        return buildJsonObject {
            put("action_id", actionId)
            put("action_type", type)
            put("completed_at", java.time.Instant.now().toString())
            put("result", result)
            put("success", result["success"]?.jsonPrimitive?.booleanOrNull ?: true)
        }
    }
}
