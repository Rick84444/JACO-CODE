# Harden Aura Desktop: evidence, session identity and end-to-end acceptance

Existing PR #362 reuses the canonical Aura runtime, Windows UI Automation/DOM Traction and Laser Vision, but source review found a mismatch between the mission's actual `metadata.executor` and the desktop preview check, plus divergent screenshot file paths. Those can make a green build appear ready while the visual panel never receives a frame.

## Goal
Preserve exactly one Aura and the original Mission Bus, ModelRelay, Win32 Input Bridge and GUI. Make desktop observation reproducible and fail closed across current mission, file integrity, real Windows interactive desktop and human takeover. Chrome Remote Desktop remains an independent viewer, not an actuator or a bypass.

## Evidence contract
- Unit/contract tests falsify stale, wrong-mission, wrong-session, changed-file and privileged input.
- Windows CI compiles native Win32 guards, parses scripts and builds the GUI.
- A real guest + Chrome Remote Desktop + operator login + Notepad workflow are mandatory physical acceptance evidence; never infer that from CI.

## Scope constraint
No new execution runtime, no cloud viewer credentials, no remote desktop protocol, no silent policy expansion, no automatic VM provisioning or automatic installation of Chrome Remote Desktop.
