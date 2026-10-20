# JACO Native Engine — Android 0.17.0

The Android engine embeds LiteRT-LM directly (`litertlm-android:0.14.0`). It is a JACO runtime component, not an external provider.

## Current migration architecture

`JACO Termux IDE -> 127.0.0.1:37621 -> JACO Native Engine app -> LiteRT-LM -> NPU/GPU/CPU`

The service is non-exported. The launcher activity starts a foreground service and owns a 256-bit pairing token in app-private preferences. The launcher performs the existing local challenge/completion pairing with the configured JACO runtime port. Copying `JACO_NATIVE_ENGINE_TOKEN` is an explicit recovery option. App Shell 3.x should replace this loopback bridge with Binder/in-process wiring so no token leaves the app boundary.

Model installation is app-private, HTTPS-only, host-allowlisted and requires an expected SHA-256 before an atomic `.part -> .litertlm` promotion. JACO governance remains outside LiteRT-LM: model-emitted tool calls are returned to JACO for policy/tool execution; LiteRT-LM automatic tool execution is disabled.

Backend `auto` attempts NPU -> GPU -> CPU and only reports the backend that successfully initialized. This is engine availability evidence, not a claim about silicon utilization percentage. JACO must benchmark/probe hardware before showing NPU telemetry as measured.

## Hands-off control boundary

The native app now includes `HandsOffAccessibilityService`, but it is disabled by default. The operator must enable it once in Android Accessibility settings. JACO then requires a second, expiring grant that names every allowed package and independently enables typing, gestures and navigation.

Supported actions are deliberately limited to `observe_screen`, `open_app`, `run_intent`, `tap`, `type_text`, `scroll`, `back` and `home`. Password fields are redacted and cannot be typed into. `run_intent` accepts only HTTPS URLs or loopback HTTP. Every JACO-side action records before/after snapshot hashes in `.jaco/state/hands-off/action-ledger.jsonl`.

The SEER relay grants only the configured strategist browser package (normally `com.android.chrome`) for a short window. It is provider-neutral: generic web, ChatGPT, Gemini, Claude and Perplexity selector profiles are included, and a custom HTTPS strategist URL may be used. It opens the configured URL in the external Android browser, enters one `JACO_STRATEGIC_STATE_V1` packet and only accepts a parseable, hash-bound `JACO_STRATEGIC_CONTROL_V1` response. Volatile timestamps are removed before snapshot hashing, so an action is not called verified merely because capture time changed.


## Native workspace controls

The launcher displays actual service/model/backend observations, installed models,
a persistent selected model/backend and configurable local runtime port. Open Aura
uses the system browser and the existing local IDE; there is no second chat, agent
store or embedded third-party browser. The Termux runtime must already be running.

Choose a `.litertlm` model through Android's document picker and supply its expected
SHA-256 from a trusted publisher. The app copies it into private storage, reports
copy progress, verifies the hash and promotes it atomically. GGUF is unsupported by
this engine. Select **Ladda vald modell** to verify and load it; **Frigör modellens
minne** unloads it. A saved selection never implies a loaded model and does not
trigger automatic inference. Installed IDs cannot be overwritten. Legacy models
without hash receipts must be removed and reimported. Original document files stay
unchanged. Imports currently belong to the visible activity; leaving/recreating it
can interrupt the copy, which must then be selected again.

Catalog hashes are installation receipts. Loading rehashes the actual file; listing
does not repeatedly read every gigabyte. Download resume retains the existing prefix,
validates Content-Range and invalidates partial files when source/hash changes.
RPC accepts at most eight connections, bounds request lines and times out idle input.
No mutation or inference is retried on an unknown transport outcome.

## Build and verification

Use JDK 17, Android SDK platform 36, build tools 35.0.0 and the included Gradle 8.11.1 wrapper:

```sh
./gradlew --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

Run from this directory with ANDROID_HOME pointing to the SDK. Unit tests exercise
temporary private files, controlled HTTP download replies and a real loopback RPC
server. The debug APK is `app/build/outputs/apk/debug/app-debug.apk`; it is a local
test build, not a signed production release. A successful build and JVM tests do
not prove behavior on a physical Android device or any specific NPU.

The service remains subject to Android's foreground-service and memory limits.
Its timeout handler stops it cleanly. The notification opens this launcher and
reports the service, not an invented claim that a model is already loaded.

See [the Cursor comparison and implementation boundaries](../../../../../../docs/architecture/android-cursor-comparison.md).
