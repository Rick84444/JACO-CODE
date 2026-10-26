# Android app without Termux: Google Play feasibility

Status: research and decision record, 2026-10-26. Nothing here was built or run on an Android device.

## Goal

One installable Android app, publishable on Google Play, that accepts a goal, executes a bounded
task in an app-private workspace, and after a forced process kill or reboot either resumes or
stops fail-closed with a receipt. No Termux, no manual commands.

Out of scope until this holds: agent marketplace, cloud billing, a full Linux userland, the
multi-process Workplace, CDP browser control and Cloudflare tunnelling.

## Findings

| Question | Finding | Basis |
| --- | --- | --- |
| Can the existing Node runtime be embedded unchanged? | No. The runtime requires Node >= 24 (`package.json` engines) and the planner, durable mission bus and Workplace store import `node:sqlite` (`gateway/src/seer.mjs`, `runtime/src/server/connected/durableMissionBus.mjs`, `gateway/src/workplace/workplace-store.mjs`). The latest nodejs-mobile release is v18.20.4 (Node 18.20.4); its release page does not mention 16 KB page-size support. | Source inspection; nodejs-mobile releases page |
| Can an app on Play drive other apps through Accessibility autonomously? | No. Since 2026-01-28 the Accessibility API policy prohibits apps that autonomously initiate, plan and execute actions; scripted deterministic automation and verified accessibility tools are exempt. | Google Play policy as reported, not read in the Play Console |
| Can the app run `git`, `node` or test runners as child processes? | Not from app-writable storage on targetSdk >= 29 (W^X). Work must run in-process. | Android platform rule, recalled; verify on a device |
| Is the existing Kotlin app a usable base? | Partly. It already has a LiteRT-LM engine host, a hash-verified model store, an authenticated loopback server and CI (`android-native.yml`). It has no mission store, planner or workspace; "Open Aura" launches the system browser against a Termux runtime. | Source inspection |

## Decision

Option A from the discussion (embed the current Node runtime) is not the cheap path: it needs a
port from Node 24 to Node 18 and our own 16 KB-aligned nodejs-mobile build before any mission
logic runs. Build the mission core natively in the existing Kotlin app instead:

- Durable mission and receipt store on the platform SQLite (`android.database.sqlite`), with
  the same fail-closed rule: an unknown outcome is recorded and never retried blindly.
- Agent loop that calls a model over HTTPS or the existing LiteRT host, one bounded step at a
  time, each step written as a receipt before and after.
- Workspace operations (read, write, patch, in-process Git) inside app-private storage.
- A foreground service with a declared type; WorkManager is not used for the loop itself.
- The Aura web UI is bundled and served to a WebView from the same process.
- Two build flavors: `play` (no Accessibility control of other apps, no downloaded executable
  code) and a separate sideload flavor that keeps the existing hands-off service.

## Acceptance and falsifier

Accepted when, on one physical phone with the Play flavor installed, a goal that edits a file in
the workspace completes, and after `adb shell am force-stop` mid-mission the next launch resumes
or stops with a receipt that names the last confirmed step, with no repeated side effect.

Rejected if any step needs Termux or a typed command, if mission state is lost, if an action
with an unknown outcome is executed a second time, or if the APK fails the 16 KB alignment check.

## Order of work

1. Mission store and receipt ledger with JVM unit tests: persistence, unknown-outcome
   quarantine, replay after simulated kill.
2. In-process workspace operations with bounds on paths and sizes.
3. Agent loop against a fake model, then a real provider, then the LiteRT host.
4. WebView shell and the foreground service.
5. Physical-device kill/reboot test and the Play flavor lint (16 KB, permissions, service types).

Steps 1 to 3 need only a JDK and the Android SDK; this machine has the SDK under
`%LOCALAPPDATA%\Android\Sdk` but no JDK on PATH, so the Gradle tests have not been run here.
