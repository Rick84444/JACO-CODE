package ai.jaco.nativeengine

import org.junit.Assert.*
import org.junit.Test

class HandsOffPolicyGuardTest {
    private val allowed = setOf("com.android.chrome", "ai.jaco.nativeengine")
    private fun rejected(fragment: String, action: () -> Unit) {
        try { action(); fail("Expected $fragment") }
        catch (error: IllegalArgumentException) {
            assertTrue(error.message.orEmpty(), error.message.orEmpty().contains(fragment))
        }
    }

    @Test fun allowsApprovedTargetAndFocusedWindow() {
        requireHandsOffTargetAllowed("tap", allowed, null, "com.android.chrome")
        requireHandsOffTargetAllowed("type_text", allowed, "com.android.chrome", "com.android.chrome")
        requireHandsOffTargetAllowed("open_app", allowed, "com.android.chrome", null)
    }

    @Test fun blocksUnlistedFocusedAppsEvenWhenPackageOmitted() {
        for (action in listOf("observe_screen", "tap", "type_text", "scroll", "back", "home")) {
            rejected("ACTIVE_PACKAGE_NOT_ALLOWED") {
                requireHandsOffTargetAllowed(action, allowed, null, "com.android.settings")
            }
            rejected("ACTIVE_PACKAGE_NOT_ALLOWED") {
                requireHandsOffTargetAllowed(action, allowed, null, null)
            }
        }
    }

    @Test fun blocksTargetSpoofingAndUnapprovedLaunches() {
        rejected("ACTIVE_PACKAGE_MISMATCH") {
            requireHandsOffTargetAllowed("tap", allowed, "com.android.chrome", "ai.jaco.nativeengine")
        }
        rejected("TARGET_NOT_ALLOWED") {
            requireHandsOffTargetAllowed("run_intent", allowed, "com.android.settings", "com.android.chrome")
        }
        rejected("TARGET_NOT_ALLOWED") {
            requireHandsOffTargetAllowed("open_app", allowed, null, null)
        }
    }
}
