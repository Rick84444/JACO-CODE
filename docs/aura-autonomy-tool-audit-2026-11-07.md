# Aura autonomy and tool audit — 2026-11-07

Status: **SOURCE-INSPECTED**. GitHub code and prior CI logs were inspected; this audit is not a proof of an end-to-end autonomous mission.

## Architecture contract

**One operator agent: Aura.** SEER, Nova and other named components are internal functions. An approved mission is delegated scope: Aura can observe, search, choose tools, edit, test, debug and replan inside the mission workspace without step-by-step approval. The operator can inspect, amend, stop, revoke or close the mission. External publishing, payments, identity and irreversible out-of-scope operations remain operator decisions.

Architecture source: operator's Drive document `aura-single-agent-functions.md`, read on 2026-11-07. Code sources: `agents/lib/approval-policy.mjs`, `runtime/src/server/gate/approvalGate.ts`, `runtime/src/server/connected/novaMissionControl.mjs`.

## Verified from source, not live execution

| Area | Code path | Assessment |
| --- | --- | --- |
| MCP connections, access and tool catalogs | `runtime/src/server/mcp/stdioMcpHost.mjs`, `runtime/gateway/src/tool-registry.mjs` | Tool registration and tool-boundary controls exist; real availability must be probed |
| Agent-native tool selection | `agents/lib/native-tools.mjs` | Schema-based tools and deferred tool search exist, reducing long provider prompts |
| Tool and skill switches | `runtime/src/server/capabilities/capabilityPolicy.mjs` | Operator switches default enabled; enabled does not mean reachable or verified |
| Durable mission execution | `runtime/src/server/connected/durableMissionBus.mjs`, `runtime/src/server/connected/novaMissionControl.mjs` | Durable tickets, leases and receipts exist; this does not certify complete goal success |
| Approval authority | `agents/lib/approval-policy.mjs`, `runtime/src/server/gate/approvalGate.ts` | Automatic in-scope local work and operator gates are separately represented |
| Browser operation | `agents/cdp-bridge.mjs`, `runtime/src/server/browser/browserHandsOff.ts` | Browser implementation exists; actual page action success must be evidenced |
| Strategy gameboard | `runtime/src/server/connected/auraPlan.mjs`, `runtime/src/components/StrategyBoard.tsx` | Steps, inferred needs, user notes and progress are visible; availability is currently partly inference |

## Findings addressed in this patch

1. **[REAL] VSIX CI packaging failure:** the extension manifest references `media/icon.png`, absent from the tracked extension. Copy the existing tracked 192px JACO brand icon into that path and explicitly allow it in `.gitignore`.
2. **[REAL] Gameboard browser regression:** the GUI now shows `StrategyBoard` by default, and the legacy `Shared gameboard` lives inside a collapsed *Technical view*. Exercise both paths in the browser test instead of waiting for an intentionally hidden section.
3. **[RISK] False helper readiness:** `needStatus('helpers')` previously returned `have` unconditionally. Require explicit `helpersVerified === true` before displaying that claim. No tool or delegation authority is removed.
4. **[RISK] Imprecise UI labels:** the configured `have` state now says `enabled`; actual execution must still be verified through a receipt.

## Next substantive autonomy work — NOT implemented by this patch

1. Create a single `CapabilityObservation` structure per (agent, tool, provider): `registered | enabled | reachable | verified | failed | unknown`, timestamp, last probe, source receipt, allowed scope and observed capability.
2. Gameboard should consume **current real capability observations** rather than a regex-matched goal and task switches as proof of readiness. Every blocker should say which tool failed, the attempted operation and the next recoverable action.
3. Add mission-owned dynamic tool discovery: Aura can search MCP schemas, rank candidate tools, run bounded in-scope actions, detect failures, revise hypotheses and retry without micro approvals; every executed step writes a durable receipt.
4. User interruptions must take priority over agent plans; changes to mission scope are versioned and reconciled with outstanding leases to avoid duplicate writes.
5. Benchmark complete missions and recovery on a fixed set of real tasks; publish passes, failures, unresolved outcomes and user interventions. A green build is not a productivity metric.

No claim is made here that helper spawning, internet-scale autonomy, full-provider routing, or a completed cross-tool mission is verified.
