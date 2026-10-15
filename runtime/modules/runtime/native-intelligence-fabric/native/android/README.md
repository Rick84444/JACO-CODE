# JACO Native Engine — Android 0.12.0

The Android engine embeds LiteRT-LM directly (`litertlm-android:0.14.0`). It is a JACO runtime component, not an external provider.

## Current migration architecture

`JACO Termux IDE -> 127.0.0.1:37621 -> JACO Native Engine app -> LiteRT-LM -> NPU/GPU/CPU`

The service is non-exported. The launcher activity starts a foreground service and owns a 256-bit pairing token in app-private preferences. For the current Termux migration bridge the operator copies that token once into JACO Vault/.env as `JACO_NATIVE_ENGINE_TOKEN`. App Shell 3.x should replace this loopback bridge with Binder/in-process wiring so no token leaves the app boundary.

Model installation is app-private, HTTPS-only, host-allowlisted and requires an expected SHA-256 before an atomic `.part -> .litertlm` promotion. JACO governance remains outside LiteRT-LM: model-emitted tool calls are returned to JACO for policy/tool execution; LiteRT-LM automatic tool execution is disabled.

Backend `auto` attempts NPU -> GPU -> CPU and only reports the backend that successfully initialized. This is engine availability evidence, not a claim about silicon utilization percentage. JACO must benchmark/probe hardware before showing NPU telemetry as measured.

## Hands-off control boundary

The native app now includes `HandsOffAccessibilityService`, but it is disabled by default. The operator must enable it once in Android Accessibility settings. JACO then requires a second, expiring grant that names every allowed package and independently enables typing, gestures and navigation.

Supported actions are deliberately limited to `observe_screen`, `open_app`, `run_intent`, `tap`, `type_text`, `scroll`, `back` and `home`. Password fields are redacted and cannot be typed into. `run_intent` accepts only HTTPS URLs or loopback HTTP. Every JACO-side action records before/after snapshot hashes in `.jaco/state/hands-off/action-ledger.jsonl`.

The SEER relay grants only the configured strategist browser package (normally `com.android.chrome`) for a short window. It is provider-neutral: generic web, ChatGPT, Gemini, Claude and Perplexity selector profiles are included, and a custom HTTPS strategist URL may be used. It opens the configured URL in the external Android browser, enters one `JACO_STRATEGIC_STATE_V1` packet and only accepts a parseable, hash-bound `JACO_STRATEGIC_CONTROL_V1` response. Volatile timestamps are removed before snapshot hashing, so an action is not called verified merely because capture time changed.
