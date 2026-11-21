# JACO Aura Desktop — isolated Windows work surface

Status: **implemented code path; not verified on a live operator VM** (2026-11-21).

## Non-negotiable ownership
Aura is the **single root agent**. Desktop AgentOS is an executor/tool, not another planner.
No new Mission Bus, ModelRelay, memory, approvals, agent identity, relay or CDP fork.

The unique existing JACO code is retained as the source of truth:

| Purpose | Existing owner, retained |
| --- | --- |
| Strategy and operator goal | SEER + Aura Runtime |
| Durable execution/receipts | `MissionClient`, `NovaMissionControl`, canonical Mission Bus and Gameboard |
| Decision/mission authority and consequence policy | `runtime/src/server/relay/modelRelay.ts`, autonomy mandates, actuator leases |
| Laser Vision | `agents/lib/mission-screen-frame.mjs`, `agents/input-bridge.ps1`; fresh screenshot, ROI, image hash and cloud-vision opt-in |
| DOM Traction, identity and Manifold Drift | `runtime/src/server/nova/tractionCore.mjs`, `DomTractionEngine` / `NovaTractionEngine` |
| Desktop semantic observation and action | `runtime/src/server/desktop/desktopHandsOff.ts`, `runtime/scripts/windows/jaco-uia-bridge.ps1` |
| Browser specialist | RobotMower and CDP; do not use DOM queries against non-browser apps |
| Durable learning and experience | existing Continuum/skills/evidence pipeline |
| Reusable operator procedure for future missions | `skills/aura-desktop/SKILL.md` (loaded through the existing Skill Engine; never grants new permissions) |

### New integration

`runtime/src/server/desktop/desktopTraction.mjs` adapts **two independent UIA observations** into the **same** `DomTractionEngine` used by the existing browser/Android track. Before a changing UIA action is sent, it checks:
- fresh, real HWND and stable PID/process identity;
- unique, enabled, on-screen semantic target, no index-only guess;
- the same target identity across both observations;
- unchanged or acceptable geometry with the existing Manifold Drift veto;
- a fresh locked target at the moment of dispatch.

The existing `DesktopHandsOffClient.executeVerified` performs this gate before the unchanged Windows UIA bridge. It continues to use the same grant, ModelRelay mandate, single-writer lease, before/after observation, action receipt, mission scope and recovery rules. A successful UI change is not automatically proof that the overall user goal is complete.

DOM Track still operates on web documents through CDP. **Desktop Traction** consumes Windows UI Automation trees; it does not pretend that arbitrary Windows applications have HTML DOMs. Laser Vision supplies fresh pixels where UIA is insufficient; the existing screen-binding policy prevents stale cross-window raw input.

## Windows screenshot + virtual mouse/keyboard (no new capture backend)

JACO **already** provides the complete native Windows primitives:
- `agents/input-bridge.ps1`: `screenshot` uses `System.Drawing.Graphics.CopyFromScreen` on the actual Windows virtual desktop (multiple monitors included), with optional crop and resize. It creates PNG; no DeskRoll API, PrintScreen clipboard or parallel screen engine is needed.
- `agents/hands-off-agent.mjs`: `computerTools.screenshot` hashes the PNG, records capture geometry/window and exposes the existing mission receipt. `agents/lib/mission-screen-frame.mjs` accepts **only the current mission's** fresh, hashed unchanged image.
- `agents/desktop-agentos.mjs`: the SEER planning call can now consume this original Laser Vision screenshot **only when `NOVA_ALLOW_CLOUD_IMAGES=1`** because the SEER proxy may route to a remote provider. When transfer is off, SEER receives only a textual provenance note, never pixels.
- The **same** `agents/input-bridge.ps1` supports `mouse_move`, `mouse_click`, `mouse_scroll`, `key_press` and `type_text` via the original Win32 SendInput; `agents/lib/input-bridge-daemon.mjs` serializes calls, associates receipts and refuses uncertain retries.
- `observedInputBinding` requires a fresh mission-bound HWND, PID, window geometry and screenshot capture for pointer input. Keyboard input needs a fresh bound UIA observation or screenshot. Dispatch attestation is **not** semantic postcondition verification.

To opt in to raw virtual input **inside a preconfigured dedicated Hyper-V Windows guest**:

```powershell
.\\agents\\setup-desktop-agentos.ps1 -EnableSandboxInput
.\\agents\\start-all.ps1
```

Setup confirms actual guest hardware through Windows CIM (Microsoft Corporation / Virtual Machine); runtime preflight checks it again. Default without the opt-in is **semantic UI Automation and screenshot only**. Even when enabled, raw input is restricted to the mission's declared tasks, existing active window/process binding and operator-action policy. Do not use raw input to bypass blocked semantic/UIA/credential/security operations.

This does not install, provision or configure Hyper-V. The operator still must provision and isolate the guest before running it.

## Isolated desktop and remote display

The first supported remote display is **Hyper-V VMConnect**, not an extra agent and not a browser DOM bridge. `agents/aura-desktop-vm.ps1` only observes, starts and opens an **existing** Windows VM. It does not create a VM, alter networking, copy host files, inject credentials, install software or execute code inside a guest.

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

Use the existing remote PWA through its established **authenticated Cloudflare Access** path to reach that guest-owned Aura Runtime. VMConnect is for operator view and takeover; the canonical mission/executor in the guest performs UIA actions. The VM must have its own allowed repository and tools. Do not mount host secrets or grant host filesystem access.

For a code/edit mission, the signed mandate grants relevant guest app processes and the mission contract bounds work to the guest worktree. Reversible guest-local operations need no click-by-click approvals; financial, outward, identity, security or destructive consequences retain the canonical approval requirements.

## Verification / status

- **Code-level:** DesktopHandsOffClient uses DomTractionEngine and refuses stale/ambiguous/cross-process UIA target locks before bridge dispatch; `tests/nova/desktop-traction.test.mjs` covers these cases.
- **Windows CI:** PowerShell parser checks the VMConnect helper; the existing Desktop AgentOS tests and TypeScript build validate integration.
- **NOT PROVEN:** a Hyper-V VM exists on the operator's PC; a guest is isolated from host drives/network; an active authenticated guest mission; live UIA click/readback; an embedded WebRTC desktop stream in JACO GUI; a real GUI acceptance receipt.

The first end-to-end acceptance mission is: **inside the guest** open Notepad, type harmless local text, save to the guest worktree, independently read back the file and show the live result in VMConnect. Do not call this DONE until the actual guest receipt exists.

## Deferred, without shadow runtimes

- Embed a remote view into the existing JACO GUI behind the existing authenticated operator surface; an embedded player must not become a second actuator or mission coordinator.
- If the canonical Core stays on the host while a guest runs **only** Desktop Worker, add an authenticated mission-specific transport and guest attestation *before* connecting it. Current `DesktopHandsOffClient` is local to its Windows runtime: do not misrepresent it as a cross-VM RPC today.
- Verify real Windows multi-monitor/foreground, installer dialogs, DPI transitions and restore-from-checkpoint behavior.

The user retains pause/stop/takeover from the existing Gameboard; the viewer grants no extra mission authority.
