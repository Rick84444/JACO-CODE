# Design: shared screenshot provenance and interactive Windows session

**Existing owners:** `agents/lib/mission-screen-frame.mjs`, `agents/input-bridge.ps1`, `agents/lib/input-bridge-daemon.mjs`, `agents/desktop-agentos.mjs`, `runtime/server.ts`, `runtime/src/components/AuraDesktopMonitor.tsx`. JACO `Mission Bus` and `ModelRelay` remain canonical.

## Diagnosed failure paths
1. Durable Nova stores executor in `mission.metadata.executor`; preview filtering on `mission.executor` rejects a real desktop mission. A legacy top-level executor must not override authoritative metadata.
2. The agent writes `NOVA_STATE_DIR || agents/.agent-state/latest-observation.png` but the GUI server builds a path from `RELEASE_ROOT/agents` which is commonly `runtime/agents`. One pure shared path resolver SHALL be used.
3. Win32 `GetForegroundWindow` and PID checks protect a chosen target but do not explicitly reject a service/session-0 or the Winlogon secure desktop. The *same* existing Win32 bridge SHALL attest the interactive session immediately before screenshots and input; this is a target-host test, not a claim that Chrome Remote Desktop is connected.
4. Human remote keyboard/mouse can race a model action even if ModelRelay has a model-only single-writer lease. Operator takeover SHALL stop/pause the mission and attest quiescence before claiming exclusive human control; no new direct input HTTP endpoint.

## Data and security
The image remains the original PNG referenced by the mission's SHA-256 receipt, no-store at rest except the original bounded file, no screenshot bytes in mission memory; web screenshot is opt-in and authenticated. Remote viewers are separate, Chrome Remote Desktop preferred and VMConnect host-local fallback. Consent to GUI viewing is separate from consent for cloud-model image inference.

## Falsifiers
- Correct `metadata.executor` mission cannot read a fresh frame → FAIL.
- Agent/server resolve different original screenshot paths → FAIL.
- Current mission or image changes after observation but an old frame is shown as live → FAIL.
- A service/session-0, wrong foreground PID/session or secure desktop can send input → FAIL.
- A visible takeover reports success while a model action may still be in flight → FAIL.
- Any CI job failure or missing real Windows guest acceptance must be reported as non-complete.
