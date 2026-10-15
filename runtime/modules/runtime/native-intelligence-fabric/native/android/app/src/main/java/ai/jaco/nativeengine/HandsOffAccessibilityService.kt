package ai.jaco.nativeengine

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.*

class HandsOffAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile var instance: HandsOffAccessibilityService? = null
            private set
    }

    override fun onServiceConnected() { instance = this }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }

    fun currentPackage(): String? = rootInActiveWindow?.packageName?.toString()

    fun observe(maxNodes: Int = 250): JsonObject {
        val root = rootInActiveWindow ?: return buildJsonObject {
            put("success", false); put("error", "No active accessibility window")
        }
        val policy = HandsOffPolicyStore.get(this)
        val packageName = root.packageName?.toString().orEmpty()
        require(policy.isActive()) { "hands-off grant is disabled or expired" }
        require(packageName in policy.allowedPackages) { "active package is not allowlisted" }
        var count = 0
        fun visit(node: AccessibilityNodeInfo, depth: Int): JsonObject {
            count += 1
            val bounds = Rect().also(node::getBoundsInScreen)
            val password = node.isPassword
            val children = mutableListOf<JsonElement>()
            if (depth < 20 && count < maxNodes) {
                for (index in 0 until node.childCount) {
                    node.getChild(index)?.let { child ->
                        try { children += visit(child, depth + 1) } finally { child.recycle() }
                    }
                    if (count >= maxNodes) break
                }
            }
            return buildJsonObject {
                put("class_name", node.className?.toString().orEmpty())
                put("view_id", node.viewIdResourceName ?: "")
                put("text", if (password) "[REDACTED_PASSWORD_FIELD]" else node.text?.toString()?.take(2_000).orEmpty())
                put("content_description", node.contentDescription?.toString()?.take(1_000).orEmpty())
                put("clickable", node.isClickable)
                put("editable", node.isEditable)
                put("scrollable", node.isScrollable)
                put("password", password)
                put("bounds", buildJsonObject { put("left", bounds.left); put("top", bounds.top); put("right", bounds.right); put("bottom", bounds.bottom) })
                put("children", JsonArray(children))
            }
        }
        val observedRoot = visit(root, 0)
        return buildJsonObject {
            put("success", true)
            put("package_name", packageName)
            put("captured_at", java.time.Instant.now().toString())
            put("node_count", count)
            put("root", observedRoot)
        }
    }

    fun find(selector: JsonObject): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val viewId = selector["view_id"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)
        val text = selector["text"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)
        val description = selector["content_description"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)
        val className = selector["class_name"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)
        val editable = selector["editable"]?.jsonPrimitive?.booleanOrNull
        val queue = ArrayDeque<AccessibilityNodeInfo>().apply { add(root) }
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            val matches = (viewId == null || node.viewIdResourceName == viewId) &&
                (text == null || node.text?.toString()?.contains(text, ignoreCase = true) == true) &&
                (description == null || node.contentDescription?.toString()?.contains(description, ignoreCase = true) == true) &&
                (className == null || node.className?.toString() == className) &&
                (editable == null || node.isEditable == editable)
            if (matches) return node
            for (index in 0 until node.childCount) node.getChild(index)?.let(queue::addLast)
        }
        return null
    }

    fun click(selector: JsonObject?, x: Float?, y: Float?, callback: (Boolean) -> Unit) {
        if (selector != null) {
            val node = find(selector)
            if (node != null) {
                var target: AccessibilityNodeInfo? = node
                while (target != null && !target.isClickable) target = target.parent
                if (target?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) { callback(true); return }
            }
        }
        require(x != null && y != null) { "tap requires a matching selector or coordinates" }
        dispatchPath(Path().apply { moveTo(x, y) }, 1L, callback)
    }

    fun typeText(selector: JsonObject?, text: String): Boolean {
        val node = if (selector != null) find(selector) else rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        require(node != null && node.isEditable && !node.isPassword) { "no non-password editable node matched" }
        val arguments = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
    }

    fun scroll(direction: String, selector: JsonObject?): Boolean {
        val node = selector?.let(::find) ?: find(buildJsonObject { put("class_name", "android.widget.ScrollView") }) ?: rootInActiveWindow
        require(node != null) { "no active node available for scroll" }
        val action = if (direction == "UP" || direction == "LEFT") AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        return node.performAction(action)
    }

    suspend fun gestureTap(x: Float, y: Float): Boolean {
        val deferred = CompletableDeferred<Boolean>()
        dispatchPath(Path().apply { moveTo(x, y) }, 1L) { deferred.complete(it) }
        return deferred.await()
    }

    private fun dispatchPath(path: Path, durationMs: Long, callback: (Boolean) -> Unit) {
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, durationMs)).build()
        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) = callback(true)
            override fun onCancelled(gestureDescription: GestureDescription?) = callback(false)
        }, null)
    }
}
