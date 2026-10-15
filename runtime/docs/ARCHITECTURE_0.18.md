# JACO Autonomus IDE 0.18 — Canonical Architecture

## 1. Control plane

`SEER` owns visible operational state: phase, goal/subgoal, active module, provider/model, cycle, workers, tools, blockers, drift, latest verified progress, current action and recent evidence events. It exposes state over HTTP and SSE to the Antigravity GUI.

`Nova Traction` is the target-lock/recovery layer. Target-bearing mutations do not bypass Nova.

`ModelRelay` is the model-independent semantic boundary. It classifies consequences, evaluates the signed autonomy mandate, acquires a single-writer actuator lease and dispatches to the correct Hands-Off surface.

## 2. Autonomy contract

`AutonomyMandate` persists under `.jaco/state/autonomy/mandates.json` and is operator-signed. One signed mandate can derive Browser/Desktop/Android grants just-in-time, preventing duplicated per-surface approval flows.

Default consequence policy:

| Class | Default |
|---|---|
| READ | ALLOW |
| LOCAL_MUTATION | ALLOW |
| EXTERNAL_MUTATION | ALLOW |
| PUBLISH | ALLOW + semantic proof required |
| FINANCIAL | REVIEW |
| AUTH | REVIEW |
| SECURITY | DENY |
| DESTRUCTIVE | REVIEW |

The common mandate horizon is capped at eight hours because Browser and Desktop grants are capped at eight hours. Revocation clears derived local grants and actuator leases.

## 3. Hands-Off surfaces

### Browser

Canonical semantic actions: `observe`, `survey`, `navigate`, `click`, `set_value`, `select`, `check`, `scroll`.

Chrome CDP stays on loopback, default `9222`. Raw debugger WebSocket URLs are not returned by the public Browser target endpoint. Passwords, OTPs, API keys and similar secret text are refused. Known authentication/payment hosts and paths are blocked.

Verification levels:

- `OBSERVED` — passive evidence collected.
- `STATE_CHANGE` — before/after state differs.
- `SEMANTIC` — state changed and the expected postcondition is satisfied.
- `UNVERIFIED` — the expected evidence was not established.

### Desktop

Windows UI Automation only; no coordinate mouse/keyboard synthesis. Process allowlist, credential/security surface refusal, secret-field redaction and before/after receipts remain inherited frozen invariants.

### Android

Accessibility/native Hands-Off client with package allowlist and observe/act/observe receipts. Physical device evidence is required before declaring the native surface available.

## 4. Multi-model operation

Multiple reasoning models may propose/evaluate work concurrently, but each actuator surface has one active writer lease at a time. JACO owns durable mission/evidence state; models are replaceable reasoning providers rather than state owners.

## 5. MCP boundary

`tools/jaco-mcp-server.mjs` exposes only semantic JACO capabilities. It does not expose shell, raw CDP evaluation or credential entry, and it cannot sign an autonomy mandate. This keeps model-provider integration separate from actuation authority.

## 6. Startup identity

Port `3000` is not treated as proof that JACO is running. `scripts/preflight_port.mjs` verifies `/api/runtime/identity`. A foreign/unidentifiable service on 3000 causes startup to fail closed. The default server bind is `127.0.0.1`; LAN exposure is explicit.
