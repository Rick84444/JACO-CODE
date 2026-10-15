# JACO Desktop AgentOS

## Purpose

Desktop AgentOS is the Windows execution surface for JACO. It extends the existing JACO runtime instead of creating a second orchestration stack.

The canonical control path is:

```text
Operator / client
      |
      v
SEER planning authority
      |
      v
Durable Nova mission bus
claim -> begin -> finish -> verified receipt
      |
      v
Desktop AgentOS executor
      |
      v
ModelRelay policy gate
signed mandate -> consequence policy -> single-writer lease
      |
      v
DesktopHandsOffClient
      |
      v
Windows UI Automation bridge
observe -> semantic action -> observe -> verification
```

Chrome Remote Desktop or another remote-display product may be used for operator access or visibility. It is not treated as the desktop automation API. JACO acts through its local runtime and Windows UI Automation.

## Reality state

- [REAL] The durable Nova mission protocol uses create, claim, begin, finish and release semantics.
- [REAL] Desktop actuation is implemented through the existing Windows UI Automation bridge.
- [REAL] Desktop mutations are routed through ModelRelay and require a signed, active autonomy mandate.
- [REAL] Desktop action receipts are verified against before/after UI observations.
- [REAL] The executor refuses startup unless the desktop surface reports `evidenceState=OBSERVED`.
- [REAL] ModelRelay enforces a single-writer actuator invariant.
- [REAL] Coordinate fallback and shell execution are disabled by default in Desktop AgentOS.
- [PROTOTYPE] `jaco-desktop-agentos-r1` is an integration branch until Windows host runtime verification and review are complete.
- [UNKNOWN] GitHub-hosted Windows CI can validate packaging, syntax and contracts but cannot prove that a specific end-user interactive desktop session is controllable. That must be verified on the installed Windows host.

## Why there is no separate Remote Agent server

An earlier Remote Agent implementation was reverted because it created a parallel control plane, called APIs that did not exist and reported hardcoded health/state. Desktop AgentOS deliberately reuses the established runtime surfaces:

- `MissionClient`
- `NovaMissionControl`
- `ModelRelay`
- `DesktopHandsOffClient`
- `jaco-uia-bridge.ps1`
- `hands-off-agent.mjs` for existing non-desktop tools

There is one mission authority and one mutation gateway.

## Supported semantic desktop actions

`desktop-action` accepts only the UI Automation action contract:

- `focus`
- `invoke`
- `set_value`
- `toggle`
- `select`
- `expand`
- `collapse`
- `scroll`

Targets are selected semantically using one or more of:

- `automationId`
- `name`
- `controlType`
- `className`
- `index`

Raw coordinates are not part of `desktop-action`.

## Installation

Requirements:

- Windows
- Node.js 24 or newer
- the JACO repository checkout
- the packaged `scripts/windows/jaco-uia-bridge.ps1`

From Windows PowerShell:

```powershell
.\agents\setup-desktop-agentos.ps1
```

The setup performs local validation, creates a gateway token when required, writes the runtime configuration and selects `desktop-agentos` as the single mission executor. It does not create or sign an autonomy mandate on the user's behalf.

Optional dependency installation:

```powershell
.\agents\setup-desktop-agentos.ps1 -InstallDependencies
```

## Start

```powershell
.\agents\start-all.ps1
```

When `JACO_EXECUTOR=desktop-agentos`, startup fails closed unless:

1. the patched runtime is reachable;
2. Windows UI Automation is supported;
3. the UIA bridge reports `OBSERVED`;
4. ModelRelay reports its single-writer invariant.

The legacy hands-off executor remains the fallback when `JACO_EXECUTOR` is not set to `desktop-agentos`. Both executors are never intentionally started by the same `start-all.ps1` invocation.

## Authorize a desktop session

In another terminal, explicitly grant the processes JACO may control:

```powershell
.\agents\grant-desktop-agentos.ps1 -Processes @('code','chrome') -Hours 1
```

The mandate is time-limited. The default policy used by the helper is:

| Consequence | Decision |
| --- | --- |
| READ | ALLOW |
| LOCAL_MUTATION | ALLOW |
| EXTERNAL_MUTATION | REVIEW |
| PUBLISH | REVIEW |
| FINANCIAL | REVIEW |
| AUTH | REVIEW |
| SECURITY | DENY |
| DESTRUCTIVE | REVIEW |

The UIA layer also maintains its own process allowlist and credential/security-surface refusals.

## Submit a mission

Clients submit work through the existing durable Nova endpoint, not a separate Remote Agent endpoint:

```http
POST /api/connected/nova/missions
```

A mission may bind to an explicit signed mandate using `mandateId`. Reusing an idempotency key intentionally reuses the existing mission, so clients should use a unique idempotency key when creating a new authorization/session context.

Mutating desktop capability is opt-in. The runtime task allowlist must include `desktop-action` before SEER can propose it.

## Verification model

For a desktop mutation to count as verified:

1. the mission turn is leased;
2. the task passes the Nova schema and allowlist;
3. the active signed mandate permits the consequence;
4. ModelRelay acquires the actuator lease;
5. the UIA bridge performs the semantic action;
6. JACO observes the desktop again;
7. the before/after evidence differs for a mutating action;
8. the receipt is persisted through the durable mission bus.

A transport failure during a mutation is treated as an unknown outcome and is not automatically retried.

## CI gate

`.github/workflows/desktop-agentos-gate.yml` validates:

- Node 24 syntax;
- the full Nova regression suite;
- absence of the reverted `sendMission()` Remote Agent contract;
- Windows PowerShell parsing;
- packaging of the real UIA bridge and its UIA pattern support;
- fail-closed startup checks for `OBSERVED` UIA and ModelRelay single-writer state.

Passing CI is necessary but not sufficient for release. A release candidate must also produce a verified receipt from an actual interactive Windows desktop session.
