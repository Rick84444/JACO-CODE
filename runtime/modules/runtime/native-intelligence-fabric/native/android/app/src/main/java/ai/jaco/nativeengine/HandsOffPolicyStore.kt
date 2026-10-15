package ai.jaco.nativeengine

import android.content.Context
import kotlinx.serialization.json.*

data class HandsOffGrantState(
    val enabled: Boolean,
    val allowedPackages: Set<String>,
    val allowTyping: Boolean,
    val allowGestures: Boolean,
    val allowNavigation: Boolean,
    val expiresAtEpochMs: Long
) {
    fun isActive(now: Long = System.currentTimeMillis()): Boolean = enabled && expiresAtEpochMs > now
}

object HandsOffPolicyStore {
    private const val PREF = "jaco-hands-off-policy"

    fun get(context: Context): HandsOffGrantState {
        val prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        return HandsOffGrantState(
            enabled = prefs.getBoolean("enabled", false),
            allowedPackages = prefs.getStringSet("allowed_packages", emptySet())?.toSet() ?: emptySet(),
            allowTyping = prefs.getBoolean("allow_typing", false),
            allowGestures = prefs.getBoolean("allow_gestures", false),
            allowNavigation = prefs.getBoolean("allow_navigation", false),
            expiresAtEpochMs = prefs.getLong("expires_at_epoch_ms", 0L)
        )
    }

    fun configure(context: Context, grant: JsonObject): HandsOffGrantState {
        val enabled = grant["enabled"]?.jsonPrimitive?.booleanOrNull ?: false
        val packages = grant["allowed_packages"]?.jsonArray?.mapNotNull {
            it.jsonPrimitive.contentOrNull?.trim()?.takeIf { value -> value.matches(Regex("^[A-Za-z0-9_.]{3,200}$")) }
        }?.toSet() ?: emptySet()
        val expiresAt = grant["expires_at"]?.jsonPrimitive?.contentOrNull?.let {
            try { java.time.Instant.parse(it).toEpochMilli() } catch (_: Throwable) { 0L }
        } ?: 0L
        if (enabled) {
            require(packages.isNotEmpty()) { "allowed_packages cannot be empty" }
            require(packages.size <= 10) { "allowed_packages cannot contain more than 10 packages" }
            require(expiresAt > System.currentTimeMillis()) { "hands-off grant must expire in the future" }
            require(expiresAt <= System.currentTimeMillis() + 24 * 60 * 60 * 1000L) { "hands-off grant cannot exceed 24 hours" }
        }
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putStringSet("allowed_packages", packages)
            .putBoolean("allow_typing", grant["allow_typing"]?.jsonPrimitive?.booleanOrNull ?: false)
            .putBoolean("allow_gestures", grant["allow_gestures"]?.jsonPrimitive?.booleanOrNull ?: false)
            .putBoolean("allow_navigation", grant["allow_navigation"]?.jsonPrimitive?.booleanOrNull ?: false)
            .putLong("expires_at_epoch_ms", expiresAt)
            .apply()
        return get(context)
    }

    fun toJson(state: HandsOffGrantState): JsonObject = buildJsonObject {
        put("enabled", state.isActive())
        put("configured", state.enabled)
        put("allowed_packages", JsonArray(state.allowedPackages.sorted().map(::JsonPrimitive)))
        put("allow_typing", state.allowTyping)
        put("allow_gestures", state.allowGestures)
        put("allow_navigation", state.allowNavigation)
        put("expires_at", if (state.expiresAtEpochMs > 0) java.time.Instant.ofEpochMilli(state.expiresAtEpochMs).toString() else "")
    }
}
