# Design: Pixel AVF terminal and app boundary

## Ownership
- `lite/install.sh` resolves a platform download from `latest.json`, checks SHA-256, installs a supported Node runtime, and retains rollback state. Use its canonical installer, not a second Pixel installer.
- `lite/START-PIXEL-TERMINAL.sh` rejects Termux and incompatible Debian environments, delegates to existing `start.mjs`; it does not run an Android host or privileged shell.
- `lite/start.mjs` owns verified release checks and loopback-only runtime start. A successful local curl is not proof of Android Chrome forwarding.
- Android APK LiteRT-LM is confined to the native engine and its token; Linux AVF VM cannot directly access app-private storage or assume 127.0.0.1 equals Android loopback.
- Windows Aura is available only over authenticated existing JACO Link when deployed and paired. No second Aura runtime or duplicate mission state.

## Packaging
Add exactly one Pixel-specific launcher to universal and android archives. A validated `JACO_LITE_PLATFORM=android` opt-in makes the canonical Linux installer select the android archive; default Linux keeps universal behavior. Never silently treat the Debian VM as Termux. Archives are checked against `latest.json` hashes, then release.json integrity is enforced again at start.

## Runtime
Use an isolated project in `~/jaco-pixel-project` by default; never modify an existing project or broaden CDP/MCP access. A bounded local environment and port preflight precedes Node runtime start.

## Verification layers
1. Contract tests: flags, missing files, old Node, wrong environment, manifest mismatch, CLI arguments, download selection, archive modes.
2. Integration: actually extract and start the released package on Linux arm64 when available; probe a real loopback HTTP endpoint.
3. APK: build debug APK and run tests/lint; neither a debug APK nor emulator unit tests establishes working Pixel NPU.
4. Manual device: install, launch, Chrome localhost, re-entry after VM suspend, service restart, and optionally connected Windows host. Record results independently.

## Safety
Explicit external deploy/paid actions need operator approval. GitHub artifacts and source are not deployment proof. Keep old Termux path as a legacy compatibility option only until a separate migration; do not invoke it in AVF.
