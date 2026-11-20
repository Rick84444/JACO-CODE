# Bonsai Android: private ChatGPT → Aura → local Android

## Current scope

This is an **on-device integration**, not a new LLM, APK or separate Aura:
- Bonsai 4B continues to run through llama.cpp on the Android host, normally `http://127.0.0.1:9380/v1` with alias `bonsai-4b`.
- The canonical JACO Core and the paired JACO Native Engine Android app must also run on the **same Android host**. The APK's Accessibility service must be enabled manually in Android settings.
- The existing private authenticated Aura MCP profile exposes `jaco_aura_android_bonsai`. Requests reach `POST /api/relay/android-bonsai` in canonical Core, which alone enforces policy and calls HandsOffClient. The public Git-ref Workplace relay remains message-only and cannot execute Android actions.
- A signed, nonexpired autonomy mandate must explicitly allow the target Android package. Core grants only that package to the native bridge for up to 15 minutes and attempts to revoke the grant after the task.
- No root, adb, shell, SMS send, account changes, buying, login, app installation, security settings or unapproved packages are authorized through this route.

## Prerequisites

1. Start the existing phone's llama.cpp server, then verify actual model availability:
   `curl --fail http://127.0.0.1:9380/v1/models`. The returned model ID must match the alias configured below.
2. In the Android Native Engine app, enable Hands-Off Accessibility in Android's Accessibility settings. Confirm JACO's existing `GET /api/hands-off/status` reports `accessibility_connected: true` from the **actual phone**.
3. Configure JACO Core on that Android device, retaining its existing native engine pairing secret and Core authentication; **do not paste any tokens into ChatGPT or commit them to Git**.
4. In Core's existing autonomy mandate UI/API, create and sign a mandate with `allowedAndroidPackages` containing only the app you want controlled (for example `com.android.chrome`). Read the returned mandate ID in your authenticated local session. No second runtime or wildcard device permission is required.
5. In the trusted Core process, optionally set `JACO_ANDROID_BONSAI_URL=http://127.0.0.1:9380/v1` and `JACO_ANDROID_BONSAI_MODEL=bonsai-4b`. The defaults are those values. The model URL must remain HTTP loopback.
6. Connect the **existing** private Aura MCP profile using `runtime/gateway/src/mcp-aura-private-stdio.mjs` and `JACO_MCP_ALLOW_AURA_MISSIONS=1`, over an authenticated private tunnel (see `docs/JACO_CHATGPT_PRIVATE_TUNNEL.md`). Ensure this is an actual connected custom MCP client; GitHub messages alone do not enable it.

## ChatGPT MCP invocation

Tool: `jaco_aura_android_bonsai`

Example arguments (illustrative values, **not** a grant):

```json
{
  "instruction": "Open Chrome and select the search field",
  "packageName": "com.android.chrome",
  "mandateId": "mandate-from-the-existing-JACO-UI",
  "maxSteps": 8
}
```

The private MCP tool checks Core readiness and authentication first. Core rejects an expired/unsigned mandate, an unallowlisted package, concurrent Android actuator ownership, sensitive operations and an unavailable native accessibility bridge.

A single inference produces at most one action. The loop re-observes the UI before acting, then Hands-Off verifies the result. Unexpected output fails closed and is not silently retried.

The returned receipt contains only task ID, action IDs, attempted and verified step counts and a status. `DONE_WITH_OBSERVED_TEXT` means a visible model-specified postcondition and verified prior action were observed; it **does not prove the whole human goal** and is not a substitute for target-device acceptance testing.

## Limitations / outstanding verification

- A Windows-hosted Aura cannot reach the phone's localhost using this route. To operate the phone remotely, deploy and verify the **existing** JACO paired device mission path. Do not expose the phone's local native port or llama.cpp port publicly as a shortcut.
- The native Android app in this repository supports Accessibility actions when installed and enabled, but code inspection and mock regression tests do not prove it is installed on the Pixel.
- Bonsai 4B's real structured JSON behavior, timeout, CPU usage and success rate need measurement on the phone.
- An actual end-to-end ChatGPT custom MCP call must be verified before calling the remote connection active. Do not publish screenshot contents, raw text or private interaction transcripts in GitHub receipts.

## Validation

`node --test tests/nova/bonsai-android-agent.test.mjs`

`cd runtime && npm run lint`

`cd runtime/gateway && node --test test/mcp-profile.test.mjs`

Only report commands that were actually run, and keep CI green before merge.
