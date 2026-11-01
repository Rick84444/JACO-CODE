# JACO for Android — 0.22.0 preview

The Android engine embeds LiteRT-LM directly (`litertlm-android:0.14.0`). It is a JACO runtime component, not an external provider.

## Current migration architecture

`JACO Termux IDE -> 127.0.0.1:37621 -> JACO Native Engine app -> LiteRT-LM -> NPU/GPU/CPU`

The service is non-exported. The launcher starts the foreground service only after the operator enables local AI. This approval is saved for subsequent launches and can be withdrawn with **Stop local AI service**. The service owns a 256-bit pairing token encrypted with Android Keystore. **Link local AI to this workspace** performs the local challenge/completion pairing only after checking the selected runtime identity. Copying `JACO_NATIVE_ENGINE_TOKEN` is an explicit recovery option.

Model installation is app-private, HTTPS-only, host-allowlisted and requires an expected SHA-256 before an atomic `.part -> .litertlm` promotion. JACO governance remains outside LiteRT-LM: model-emitted tool calls are returned to JACO for policy/tool execution; LiteRT-LM automatic tool execution is disabled.

Backend `auto` attempts NPU -> GPU -> CPU and only reports the backend that successfully initialized. This is engine availability evidence, not a claim about silicon utilization percentage. JACO must benchmark/probe hardware before showing NPU telemetry as measured.

## Hands-off control boundary

The native app now includes `HandsOffAccessibilityService`, but it is disabled by default. The operator must enable it once in Android Accessibility settings. JACO then requires a second, expiring grant that names every allowed package and independently enables typing, gestures and navigation.

Supported actions are deliberately limited to `observe_screen`, `open_app`, `run_intent`, `tap`, `type_text`, `scroll`, `back` and `home`. Password fields are redacted and cannot be typed into. `run_intent` accepts only HTTPS URLs or loopback HTTP. Every JACO-side action records before/after snapshot hashes in `.jaco/state/hands-off/action-ledger.jsonl`.

The SEER relay grants only the configured strategist browser package (normally `com.android.chrome`) for a short window. It is provider-neutral: generic web, ChatGPT, Gemini, Claude and Perplexity selector profiles are included, and a custom HTTPS strategist URL may be used. It opens the configured URL in the external Android browser, enters one `JACO_STRATEGIC_STATE_V1` packet and only accepts a parseable, hash-bound `JACO_STRATEGIC_CONTROL_V1` response. Volatile timestamps are removed before snapshot hashing, so an action is not called verified merely because capture time changed.


## Native workspace controls

The launcher displays actual service/model/processor observations, installed models,
a persistent model/processor preference and a configurable JACO runtime URL. English
is the default language; the in-app selector switches all controls and notification
text to Swedish. Model prompt language remains independent.

**Check connection** and **Open Aura** request `/api/runtime/identity` and require
canonical JSON product, version, release and protocol fields. HTTP is accepted only
for loopback; a remote hub requires HTTPS and normal certificate validation.
Credentials, paths and query strings are rejected in runtime addresses. Redirects,
HTML responses, sidecar identities and oversized identity bodies do not pass.
This is a read-only product identity observation, not a browser login, provider
handshake or proof that a task completed. Open Aura uses the system browser and the
existing canonical workspace; there is no second chat, planner or agent store.
The phone engine token is never sent to a remote hub.

This APK contains the local LiteRT engine and Android integration. It does **not**
embed the full Node/Aura workspace. For a local workspace, install the matching
Android/Termux runtime package, approve installation, start it in Termux, then check
its loopback URL here. **Set up the workspace** explains these steps and opens the
installed Termux app through an Android intent. If Termux is absent it opens the
official Termux installation documentation. A trusted HTTPS JACO hub is an
alternative for browser access, but remote hubs cannot directly use this local
engine-token bridge.

Provider and MCP connections are configured in Aura using its existing connection
controls. Environment import and local discovery are approved in that workspace;
the native app does not search other apps or shared storage for credentials.

Choose a `.litertlm` model through Android's document picker and supply its expected
SHA-256 from a trusted publisher. The app copies it into private storage, reports
copy progress, verifies the hash and promotes it atomically. GGUF is unsupported by
this engine. Select **Load selected model** to verify and load it; **Free model memory** unloads it. A saved selection never implies a loaded model and does not
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
temporary private files, controlled HTTP download replies, a real loopback RPC
server, runtime address/identity rejection and a real HTTP identity probe that
refuses redirects, HTML and oversized bodies. The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. CI copies it to
`build/distribution/JACO-Android-preview.apk` and produces a SHA-256 file in the
`JACO-Android-preview` artifact. It is an installable preview signed with a debug
key, not a signed production release. Keep the existing application ID
`ai.jaco.nativeengine`; production updates require the same stable signing key as
the installed app. A different debug signing key may require uninstalling the old
preview, which removes its private models and settings. Do not uninstall a working
installation without backing up its source models and relevant workspace state. A successful build and JVM tests do
not prove behavior on a physical Android device or any specific NPU.

The service remains subject to Android's foreground-service and memory limits.
Its timeout handler stops it cleanly. The notification opens this launcher and
reports the service, not an invented claim that a model is already loaded.

See [the Cursor comparison and implementation boundaries](../../../../../../docs/architecture/android-cursor-comparison.md).
