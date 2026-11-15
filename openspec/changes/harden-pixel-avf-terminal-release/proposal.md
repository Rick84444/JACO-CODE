# Harden Pixel AVF Debian Terminal release

## Why
The unmerged Pixel delivery (#224) is 39 commits behind current main, is not covered by an OpenSpec change, and its phone download path is ambiguous: Linux Debian selects the universal archive, while the Pixel-specific launcher lives in an Android variant. The Android APK build alone does not prove Debian VM startup, APK-to-VM connectivity or an authenticated Windows Aura link.

## What Changes
- Integrate the Pixel Debian launcher, Lite release packaging and optional Android-local model chat onto current main, retaining all later runtime, installer and security changes.
- Provide a reproducible, checksum-verified Debian arm64 installation path that chooses the correct Lite archive and starts on VM loopback only.
- Test guardrails for wrong OS, Termux, old Node, missing SQLite, missing or tampered release and non-VM host access.
- Test APK compile, unit and lint on the integrated revision; keep local LiteRT as a separate inference surface, Windows Aura as the sole remote agent.
- Exercise release archive extraction/start on Linux arm64 where CI runners are available, and explicitly track missing physical Pixel proof.

## Scope
Existing owners: `lite/` launcher/installer, `tools/build-lite.mjs` packager, `runtime/modules/runtime/native-intelligence-fabric/native/android/` native engine client, and existing JACO Link. No new agent, planner, cloud account or bridge.

## Acceptance / Falsifiers
Accept only if source, tests and exact-head CI demonstrate a runnable Debian arm64 package with checked assets, proper localhost isolation, and buildable Android APK. Falsify with a missing launcher, a misselected zip, a false READY status, an unexpected external listener, repeated unknown-effect calls, or red CI. Physical Pixel and live Windows pairing remain [UNKNOWN] until a real device and deployed service produce evidence.

## Baseline
Latest GitHub main as of 2026-11-15. Existing PR #224 based on older main is source input only. Code changes on this spec branch must preserve unrelated main history.
