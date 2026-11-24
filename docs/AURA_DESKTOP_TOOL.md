# JACO Aura Desktop — isolated Windows work surface

Status: **implemented code path; not verified on a live operator VM** (2026-11-21).

**Installationsmanual för Laser Vision:** [JACO_LASER_VISION_SETUP.md](JACO_LASER_VISION_SETUP.md) beskriver den faktiska konfigurationen, opt-in, bildflödet, diagnostik, fjärrvisning, kvitton och det ännu ej genomförda fysiska acceptanstestet.

## Non-negotiable ownership
Aura is the **single root agent**. Desktop AgentOS is an executor/tool, not another planner.
No new Mission Bus, ModelRelay, memory, approvals, agent identity, relay or CDP fork.

The unique existing JACO code is retained as the source of truth:

| Purpose | Existing owner, retained |
| --- | --- |
| Strategy and operator goal | Aura Cognitive Runtime (single planner and mission authority) |
| Durable execution/receipts | `MissionClient`, `NovaMissionControl`, canonical Mission Bus and Gameboard |
| Decision/mission authority and consequence policy | `runtime/src/server/relay/modelRelay.ts`, autonomy mandates, actuator leases |
| Laser Vision | `agents/lib/mission-screen-frame.mjs`, `agents/input-bridge.ps1`; fresh screenshot, ROI, image hash and cloud-vision opt-in |
| Target Track, identity and Manifold Drift | `runtime/src/server/nova/tractionCore.mjs`, `TargetTractionEngine` / `NovaTractionEngine` |
| Desktop semantic observation and action | `runtime/src/server/desktop/desktopHandsOff.ts`, `runtime/scripts/windows/jaco-uia-bridge.ps1` |
| Browser specialist | RobotMower and CDP; do not use DOM queries against non-browser apps |
| Durable learning and experience | existing Continuum/skills/evidence pipeline |
| Reusable operator procedure for future missions | `skills/aura-desktop/SKILL.md` (loaded through the existing Skill Engine; never grants new permissions) |

### New integration

`runtime/src/server/desktop/desktopTraction.mjs` adapts **two independent UIA observations** into the **same** `TargetTractionEngine` used by the existing browser/Android track. Before a changing UIA action is sent, it checks:
- fresh, real HWND and stable PID/process identity;
- unique, enabled, on-screen semantic target, no index-only guess;
- the same target identity across both observations;
- unchanged or acceptable geometry with the existing Manifold Drift veto;
- a fresh locked target at the moment of dispatch.

The existing `DesktopHandsOffClient.executeVerified` performs this gate before the unchanged Windows UIA bridge. It continues to use the same grant, ModelRelay mandate, single-writer lease, before/after observation, action receipt, mission scope and recovery rules. A successful UI change is not automatically proof that the overall user goal is complete.

Target Track's browser adapter operates on web documents through CDP. **Desktop Traction** consumes Windows UI Automation trees; it does not pretend that arbitrary Windows applications have HTML DOMs. Laser Vision supplies fresh pixels where UIA is insufficient; the existing screen-binding policy prevents stale cross-window raw input.

### One intent, minimal commands

Aura Chat offers read-only `target_track({target:'Save'})` **when the tool is actually discovered**. It performs one `nova_observe` over the existing gated `mcp_read` route; if the named visible control is absent, it can perform one `nova_ax` fallback in the same high-level tool call. The response contains bounded role/name/selector hints, the observation source and explicit `CANDIDATE`/`AMBIGUOUS`/`NOT_FOUND` state. Neither a candidate nor a screenshot is an action receipt; the browser actuator must re-identify the target again before any click. Legacy `dom_track` calls keep their prior interface, and no new tool authorization is introduced.

For full autonomous missions, ask Aura for the **goal**, not a sequence of DOM/AX/CDP commands. When a target is already known on the authorized attached page, existing `browser-click`/`browser-type` performs the fresh identity check, so the planner need not issue a separate preliminary survey. For a Windows program, existing `desktop-windows`, `desktop-observe` and `desktop-action` remain authoritative; this chat convenience tool does **not** pretend to control UIA or Android. An action with unknown outcome is reconciled from evidence, never blindly repeated.

## Windows screenshot + virtual mouse/keyboard (no new capture backend)

JACO **already** provides the complete native Windows primitives:
- `agents/input-bridge.ps1`: `screenshot` uses `System.Drawing.Graphics.CopyFromScreen` on the actual Windows virtual desktop (multiple monitors included), with optional crop and resize. It creates PNG; no Chrome Remote Desktop API, PrintScreen clipboard or parallel screen engine is needed.
- `agents/hands-off-agent.mjs`: `computerTools.screenshot` hashes the PNG, records capture geometry/window and exposes the existing mission receipt. `agents/lib/mission-screen-frame.mjs` accepts **only the current mission's** fresh, hashed unchanged image.
- `agents/desktop-agentos.mjs`: Aura's planning adapter uses the original Laser Vision screenshot **only when `NOVA_ALLOW_CLOUD_IMAGES=1`**, because the underlying model connection may route to a remote provider. When transfer is off, the planner receives only a textual provenance note, never pixels. Historical `seer*` function names are compatibility interfaces, not a separate agent.
- The **same** `agents/input-bridge.ps1` supports `mouse_move`, `mouse_click`, `mouse_scroll`, `key_press` and `type_text` via the original Win32 SendInput; `agents/lib/input-bridge-daemon.mjs` serializes calls, associates receipts and refuses uncertain retries.
- `observedInputBinding` requires a fresh mission-bound HWND, PID, window geometry and screenshot capture for pointer input. Keyboard input needs a fresh bound UIA observation or screenshot. Dispatch attestation is **not** semantic postcondition verification.

To opt in to raw virtual input **inside a preconfigured dedicated Hyper-V Windows guest**:

```powershell
.\\agents\\setup-desktop-agentos.ps1 -EnableSandboxInput
.\\agents\\start-all.ps1
```

Setup confirms actual guest hardware through Windows CIM (Microsoft Corporation / Virtual Machine); runtime preflight checks it again. Default without the opt-in is **semantic UI Automation and screenshot only**. Even when enabled, raw input is restricted to the mission's declared tasks, existing active window/process binding and operator-action policy. Do not use raw input to bypass blocked semantic/UIA/credential/security operations.

This does not install, provision or configure Hyper-V. The operator still must provision and isolate the guest before running it.

## Visible execution: one screen, two views

**True continuous view (recommended):** install and configure **Chrome Remote Desktop** inside the dedicated Windows guest, then connect from the operator's computer/phone through https://remotedesktop.google.com/access. Hyper-V **VMConnect** remains the host-local fallback. Both viewers must be checked to display the **same interactive Windows session** as JACO's Win32/UIA worker; never assume session identity across remote logins or Windows desktop switches. Aura's native input works within that session, not through Google's API. Neither viewer becomes an agent, second executor or authority source. Stop/pause the mission before manual takeover: a separate human cursor is not controlled by the ModelRelay lease.

**In JACO GUI:** the existing `AuraLiveStage` now contains an optional read-only **Windows Desktop** panel. It requests `GET /api/aura/desktop/live-frame` only after the operator clicks **Visa skärmbild**, while the UI is visible and an ACTIVE `desktop-agentos` mission exists. The response is the existing `agents/input-bridge.ps1` PNG, exposed after `freshMissionFrame` checks original mission receipt, SHA-256, modification time, age (12 seconds), and invalidating actions. Server sends only `image/png` with private/no-store headers. Authentication is inherited from JACO's local IDE or signed-in remote IDE session; no query token, public file path, browser CDP action or new capture worker is created.

This is **an observed snapshot refreshed when new mission screenshots arrive, not 30 FPS video**. When no fresh verified screenshot exists, the panel reports the absence rather than displaying old frames as live. Chrome Remote Desktop (or host-local VMConnect) remains the continuous remote-viewing and takeover layer.

Operator screen-sharing opt-in: `JACO_AURA_DESKTOP_SCREEN_VIEW=1`. This is enabled by `setup-desktop-agentos.ps1 -EnableSandboxInput` when run inside a verified Hyper-V Windows guest and may otherwise be configured explicitly by the operator. Default is off. No camera content or image is sent to a model merely by enabling this GUI view; separate `NOVA_ALLOW_CLOUD_IMAGES=1` is still required to send a screenshot through the SEER proxy to a potentially cloud model.

**Live acceptance (not yet performed):** a real Windows guest, live remote window, one active authenticated mission, mouse/keyboard movements visibly reflected in the window, matching verified mission receipts, and a corresponding recent frame shown in Aura Live Stage. No current GitHub CI result attests this physical end-to-end behavior.

## Isolated desktop and remote display

The recommended viewer is **Chrome Remote Desktop installed inside the Windows guest**; native Hyper-V VMConnect remains the built-in host-local fallback. Neither is an extra agent or a browser DOM bridge. `agents/aura-desktop-vm.ps1` only observes, starts and opens an **existing** Windows VM. It does not create a VM, alter networking, copy host files, inject credentials, install software or execute code inside a guest.

On the Windows host with Hyper-V installed, create/configure a dedicated **Windows VM** named `JACO-Aura-Desktop`. Install a licensed Windows guest. Review Hyper-V networking, host drive/resource redirection, VM checkpoint/restore and administrator rights. Do not expose guest RDP or the JACO Core port publicly. Use the host's Hyper-V Manager to establish the boundary before claiming isolation.

From PowerShell on the host:

```powershell
.\agents\aura-desktop-vm.ps1 -Action Status
.\agents\aura-desktop-vm.ps1 -Action Start
.\agents\aura-desktop-vm.ps1 -Action Open
```

`Open` launches the native VMConnect **remote window**. A viewer launch only proves that Windows accepted the launch request; it does **not** prove that the VM guest, Aura or desktop automation is ready.

Within the guest, install **the one canonical JACO-CODE runtime** using its normal Windows setup. For a dedicated Aura VM deployment, stop/disable the former host runtime before switching to the guest runtime: two independent Aura instances must never operate the same mission ledger.

Within the interactive guest desktop (not an unattended Windows service/session-0):

```powershell
.\agents\setup-desktop-agentos.ps1
.\agents\start-all.ps1
```

Use the existing remote PWA through its established **authenticated Cloudflare Access** path to reach that guest-owned Aura Runtime. Chrome Remote Desktop is for continuous operator viewing and takeover from another device, and VMConnect is the local host fallback; the canonical mission/executor in the guest performs UIA actions. The VM must have its own allowed repository and tools. Do not mount host secrets or grant host filesystem access.

For a code/edit mission, the signed mandate grants relevant guest app processes and the mission contract bounds work to the guest worktree. Reversible guest-local operations need no click-by-click approvals; financial, outward, identity, security or destructive consequences retain the canonical approval requirements.

The exported `DomTractionEngine` and legacy `dom_track` remain compatibility aliases. The new `target_track` chat tool is currently a read-only browser adapter, not a universal actuator. Windows actions continue through DesktopHandsOff/ModelRelay.

## Verification / status

- **Code-level:** DesktopHandsOffClient uses TargetTractionEngine and refuses stale/ambiguous/cross-process UIA target locks before bridge dispatch; `tests/nova/desktop-traction.test.mjs` covers these cases.
- **Windows CI:** PowerShell parser checks the VMConnect helper; the existing Desktop AgentOS tests and TypeScript build validate integration.
- **NOT PROVEN:** a Hyper-V VM exists on the operator's PC; a guest is isolated from host drives/network; Chrome Remote Desktop is installed or connected in that guest; an active authenticated guest mission; live UIA click/readback; an embedded WebRTC desktop stream in JACO GUI; a real GUI acceptance receipt.

The first end-to-end acceptance mission is: **inside the guest** open Notepad, type harmless local text, save to the guest worktree, independently read back the file and show the live result in Chrome Remote Desktop (or host-local VMConnect). Do not call this DONE until the actual guest receipt exists.

## Deferred, without shadow runtimes

- Embed a remote view into the existing JACO GUI behind the existing authenticated operator surface; an embedded player must not become a second actuator or mission coordinator.
- If the canonical Core stays on the host while a guest runs **only** Desktop Worker, add an authenticated mission-specific transport and guest attestation *before* connecting it. Current `DesktopHandsOffClient` is local to its Windows runtime: do not misrepresent it as a cross-VM RPC today.
- Verify real Windows multi-monitor/foreground, installer dialogs, DPI transitions and restore-from-checkpoint behavior.

The user retains pause/stop/takeover from the existing Gameboard; the viewer grants no extra mission authority.
