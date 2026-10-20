package ai.jaco.nativeengine

/**
 * Authorization must apply to the currently focused package, not only to an
 * optional package_name supplied by the agent.
 */
internal fun requireHandsOffTargetAllowed(
    type: String,
    allowedPackages: Set<String>,
    requestedPackage: String?,
    activePackage: String?
) {
    when (type) {
        "open_app", "run_intent" -> {
            require(!requestedPackage.isNullOrBlank() && requestedPackage in allowedPackages) {
                "HANDS_OFF_TARGET_NOT_ALLOWED"
            }
        }
        "observe_screen", "tap", "type_text", "scroll", "back", "home" -> {
            require(!activePackage.isNullOrBlank() && activePackage in allowedPackages) {
                "HANDS_OFF_ACTIVE_PACKAGE_NOT_ALLOWED"
            }
            if (!requestedPackage.isNullOrBlank()) {
                require(requestedPackage == activePackage) { "HANDS_OFF_ACTIVE_PACKAGE_MISMATCH" }
            }
        }
        else -> throw IllegalArgumentException("HANDS_OFF_ACTION_UNKNOWN")
    }
}
