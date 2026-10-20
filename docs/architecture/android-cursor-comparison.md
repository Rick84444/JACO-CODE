# Android workspace decisions informed by Cursor feedback

Research date: 2026-10-20. This is a qualitative comparison, not a benchmark or a
representative satisfaction survey. Reviews and forum posts identify scenarios to
investigate; they do not establish that every Cursor user sees the same problems.

## Evidence and product decisions

| Observed feedback or documented capability | JACO decision | Delivery boundary |
| --- | --- | --- |
| G2's review page highlights ease of use, contextual code assistance and fast development; criticism includes inconsistent suggestions, price and slowdown on large projects. | Keep Aura as the single project/chat/agent workspace. The Android launcher opens the same local workspace instead of introducing a separate history or agent loop. | Existing Aura capabilities are reused; this change does not create Cursor-equivalent autocomplete or indexing. |
| A mobile user reports model/effort settings not persisting, unclear interrupted runs and difficulty selecting complete replies. | Persist native model/backend choices, distinguish chosen settings from actual loaded-engine observations, and expose uncertain outcomes. Add full-message copying with a manual fallback in Aura. | Selection persistence is implemented; context compaction and billing metering are separate existing runtime responsibilities. |
| Cursor's current mobile documentation describes iOS agent control, cloud/local-computer execution and Android as planned. Editor, terminal, file browser and MCP/skill management are listed outside its native mobile app. | Provide direct entry to the existing full local Aura workspace, plus native on-phone model management through Android's document picker. | This launcher still requires the local Termux runtime for the IDE. It does not bundle Node or turn Android document URIs into writable Git projects. |

Sources:

- [G2: Cursor pros and cons, including named reviews](https://www.g2.com/products/cursor/reviews?page=2&qs=pros-and-cons).
- [Cursor forum: mobile context, selection persistence and copying report](https://forum.cursor.com/t/mobile-cloud-agent-context-limit-crashes-thinking-ui-bugs-model-persistence-copy-selection-issues-and-feature-requests/169678). This report concerns iOS devices, not an existing native Cursor Android app.
- [Cursor mobile documentation](https://cursor.com/docs/cloud-agent/mobile).
- [Cursor's Android feature-request response](https://forum.cursor.com/t/cursor-android-mobile-app/165496/19), dated July 27, 2026; the current documentation above is the stronger availability source.

## Problems found directly in JACO

The previous Android screen exposed pairing and accessibility settings, but no
model catalog, import, loaded-backend observation or direct workspace entry.
Pairing errors could include entire server response bodies. Model IDs were silently
rewritten into filenames, creating aliases. Catalog refreshes hashed every complete
model repeatedly. A resumed download opened a truncating output stream before
seeking, destroying the retained prefix. Engine load, inference and close were not
serialized; a failed backend initialization could leak its newly created engine.
Local RPC accepted unbounded lines and connections without a read timeout.
Android lint also found an unguarded API-28 StrongBox exception in a project with
minimum API 26; fallback is now isolated behind the version check, and token
creation/rotation is serialized.

The implementation extends the same ModelStore, LiteRtEngineHost and authenticated
loopback protocol. Imports and HTTPS downloads require an external expected SHA-256;
the app never overwrites installed model IDs. Download continuation uses append mode,
checks the returned range and binds partial files to the source URL and expected
hash. Loading verifies stored bytes again. List operations return recorded hashes,
not a fresh integrity claim. Older files without a receipt need removal and verified
reimport. Inference and lifecycle operations are serialized, active model deletion
is refused, and model unloading releases memory explicitly.

The launcher polls actual observations while visible, retains selections and the
runtime port, imports private copies with progress, and links to Aura in the system
browser. It never automatically runs inference or restores a model into memory.
Android Accessibility remains optional for controlling other apps and is explained
separately from ordinary model/chat use. Notification permission enables visibility;
it does not authorize accessibility actions. Pairing response bodies and tokens are
not displayed as error details.

## Verification and remaining acceptance

Run the Android unit tests and APK build described in the native Android README.
Tests cover actual file copies and hashes, failure cleanup, identity/path bounds,
resumed/restarted downloads and the real authenticated loopback transport, including
token rotation. HTTP download replies are controlled fixtures, not public model
downloads. They do not establish the LiteRT model's inference quality.

Physical Android acceptance must cover the document picker, rotation during import,
notification denial, keyboard/insets, accessibility consent, NPU/GPU fallback,
low memory/storage and switching between Aura and the launcher. The existing
`dataSync` foreground service still has Android's lifecycle restrictions; a timeout
now stops the service cleanly instead of claiming continuous availability. This is
not an unlimited background-execution guarantee. See [Android foreground-service
timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout).

Next work should be evaluated against real mobile tasks: reviewing a multi-file
diff, attaching a project, recovering an interrupted agent and understanding context
and actual token usage. These are acceptance scenarios, not claims of completed
Cursor parity.

Observed local checks for this change: Gradle-wrapper APK build and Android lint
passed; 12 Kotlin tests, 26 targeted runtime tests and 8 workspace UI/CDP tests
passed. Aura TypeScript checks and its production build also passed. No physical
Android device or emulator session was observed.
