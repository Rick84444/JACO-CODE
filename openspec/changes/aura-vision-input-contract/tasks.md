- [x] Trace existing vision, browser, desktop and traction paths.
- [x] Wire native frame delivery, checked input dispatch and track invariants.
- [x] Add targeted tests and Windows parser gate.
- [ ] Verify CI at exact head and target host.
- [ ] Validate foreground-bound raw action tracking and live browser/desktop workflows.

- [x] Implement combined drift veto, turn-preserving frame request, shared DOM identity and receipt-bound Win32 input.
- [x] Add regression cases and Windows compile/entropy fixture gate.
- [ ] Observe passing CI at exact PR head and exercise focus/geometry changes on target Windows device.

## Aura Desktop product closure — strict production gates (2026-11-21)

- [x] Reuse canonical Aura Runtime, Nova Mission Bus, ModelRelay single-writer, Win32 screenshot/input bridge, Windows UI Automation and existing traction engine; do not fork a second executor or desktop authority.
- [x] Add Chrome Remote Desktop as **operator-installed** recommended interactive viewer; retain host-local Hyper-V VMConnect. Neither is used as Aura's actuation channel.
- [x] Enforce interactive Windows session identity in the native bridge and mission-bound screenshot receipts; fail closed on missing/changed session.
- [x] Add a signed-in, opt-in, read-only Live Stage preview from recent hash-verified mission screenshots. Do not mislabel periodic still images as continuous video.
- [x] Make manual takeover a two-phase operation: operator pauses the canonical mission, then waits until the mission's planning/execution lease, UIA single-writer and ModelRelay DESKTOP actuator lease are all idle; block takeover on missing lease evidence.
- [x] Add regression assertions for verified screenshot freshness, UIA target identity, session switching, token-free mission lease projection and no concurrent UIA writer.
- [ ] Verify the exact PR HEAD with all required CI checks green. A failed or pending workflow is not a passing result.
- [ ] Install/configure a dedicated licensed Hyper-V Windows guest with independent guest account and restricted host drive/device redirection; verify network and file-sharing isolation. Current helper opens an existing VM; it does **not** provision it.
- [ ] Install Chrome Remote Desktop in the guest through the operator's own account flow, then verify viewer and Aura Win32 input use the **same** interactive Windows session after connect/reconnect, lock/unlock, display resizing and DPI changes.
- [x] Add an operator-run **read-only** live-guest acceptance probe in `agents/aura-desktop-acceptance.ps1` (Windows session, WMI Hyper-V identity, native PNG capture, UIA/read-only runtime status, optional exact mission/expected file SHA evidence). Parse-check on Windows CI; it **never** certifies the external viewer, performs mutation, or replaces the full E2E mission.
- [ ] Run a REAL non-mocked acceptance mission through the canonical runtime: open Notepad, write harmless text, save into guest-owned path, independently read and compare exact saved bytes, confirm the desktop action receipts in Gameboard and observe the same session through Chrome Remote Desktop. A model claim or successful tool dispatch alone is not proof.
- [ ] Test failure/recovery: close/move target window between UIA observations, unplug viewer, switch foreground/session, trigger lease timeout and process restart; require safe refusal or re-observation, no blind replay of uncertain writes.
- [ ] Verify operator pause/takeover excludes all in-flight mutation paths, human manual action does not race Aura, and resume requires fresh observations and a valid mandate.
- [ ] Preserve an acceptance receipt containing real host/guest session checks, mission ID, receipt references, timestamps, exact release/commit SHA and pass/fail evidence. Do not expose device identifiers, credentials or captured screen pixels in public GitHub.
- [ ] Merge to main only after required CI + actual Windows acceptance are independently documented; until then **IMPLEMENTED IN CODE / LIVE NOT VERIFIED**.
