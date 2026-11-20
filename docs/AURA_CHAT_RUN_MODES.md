# Aura Chat: Manual, Planning, Full Autonomous and Build Agent

This is **one** JACO GUI inside the browser and the VS Code full-GUI extension. No second agent, planner, permission registry or model process was created.

## Operator experience

The operator-facing composer is **Full Autonomous** from the first render, on reload, and after using suggestions. Old stored Manual/Planning preferences cannot change the mode. A non-interactive, motion-safe blue status label replaces the mode picker. There is no automatic work submission on page load.

| Control | Dispatch |
|---|---|
| **Send message** | `POST /api/aura/chat` with `interactionMode:action`; Aura can use authorized tools for explicit orders, and ordinary questions remain conversational. |
| **Start mission** | `POST /api/aura/workbench/start-goal` with `executionMode:autonomous`; explicit durable Gameboard mission, independent of the chat response. |
| **Stop / Steer** | Existing operator controls for the identified running mission. |

The Manual and Planning API contracts remain available for read-only integrations and compatibility; they are not selectable GUI states. The runtime continues to enforce per-tool permission, approvals, budgets and authorization. A mode label is never an authority grant. A chat work order should use the existing `start_goal` tool when available, avoid duplicate missions, or direct the operator to the explicit mission button if it cannot dispatch. A chat narrative is not an execution receipt.

Clicking **Build Agent** opens a compact form inside the conversation. Typing `build agent` in the Manual/Planning composer does the same. Name, role, responsibility, success criteria and an operator credential are supplied to the **existing** `POST /api/aura/organization/agents`. A successful record is under Aura, with `L1`, no permissions, no paid model budget, no started worker and no invented communication identity. Its token is only held in component memory, not localStorage. No autonomous model output can bypass the operator-authenticated endpoint by claiming to be the operator.

## Knowledge and Skills

For each chat turn, the backend uses existing **Continuum KnowledgeStore** and **Skill Runtime** to retrieve compact candidates. Only evidence-backed `verificationStatus: VERIFIED` knowledge and `status: ACTIVE` skills are included in this optional, read-only context. Invalid/stale facts, candidate/retired skills and unavailable catalogs yield no fabricated matches.

The composer can show small live counts for matching verified knowledge and eligible skill candidates. Full details remain in existing Skills/Knowledge views; we do not create another modal or catalog.

**Critical:** discovery is not activation permission. Every skill proposal is explicitly tagged `DISCOVERED_NOT_AUTHORIZED`. Running a skill's procedure requires the current mission, operator-approved scope, per-step tool permission, budget and approval constraints. This PR does **not** claim that `AgentOrganization.decide()` is wired into every Nova and Skill Runtime execution step; that enforcement is the next hardening task. A chat mode cannot override an existing deny.

## Acceptance

- Invalid interaction modes yield HTTP 400, instead of silently changing a command into ordinary chat.
- Manual/Planning use only the read-oriented toolbox; Planning does not include the previously available policy-change exception.
- Full Autonomous keeps chat available; the separate Start mission button directly creates a durable canonical mission and returns a real acknowledged ID without creating a second executor. Chat dispatch remains subject to existing tool contracts.
- Full Autonomous is the only operator-facing mode on every session; a non-interactive status has a subtle motion-safe pulse.
- Build Agent stays within the existing operator-key route; no API key is sent to an LLM, no auto-grant.
- Knowledge must have verified evidence; skill candidates must be ACTIVE, with **no** execution authority inferred.
- Pass contract/unit tests, TypeScript, production frontend/backend build, and target-host browser interaction. CI does not by itself prove local Windows/Termux or VS Code behavior.

## Operator stop from the conversation

The Aura conversation may request cancellation of an observed active mission through the existing `/api/aura/workbench/missions/:id/cancel` route. The runtime keeps its own graph-cancellation and mission-receipt semantics. A successful request confirms that stop was requested, not that an in-flight tool or the complete mission has already stopped. This control is separate from cancelling a chat response. Operator steering within an ACTIVE mission is now available from the same composer through **Ändra uppdrag / Steer mission**. This is an explicit operator-only action; the internal Manual/Planning API remains read-only and autonomous work still requires explicit submission. The request is persisted as an immutable `NOVA_OPERATOR_STEER` event with a unique request ID in the existing mission bus, with no second planner or model call.

Each model turn reads the latest steering revision. The existing `begin` boundary rejects an action planned against an older revision (`NOVA_STEER_STALE`) before starting any new tool, and stale completion/replan/blocking proposals are rejected. If an action is already executing, its lease and receipt are preserved; any subsequent batched step must use the new revision. The UI reports **queued for next planning step**, not already applied or verified. No model/plan/contract/permissions/budget changes result from steering, and the original parent graph's acceptance remains authoritative. A fundamentally different goal or expanded scope must be submitted as a new mission with appropriate authorization. Steering is not yet a generalized graph-node rewrite, and real device/provider tests remain necessary.

## Context limits and interactive latency

The chat uses the existing primary model selection directly when it is registered, without an extra SEER planning hop. This does not make a shared physical local model concurrently available while another inference is running.

Prompt construction retains the latest instruction and distributes the remaining context among verified observations, recent conversation, repository knowledge and tool receipts. Default user-context budgets: `JACO_AURA_LOCAL_CONTEXT_CHARS=5200` and `JACO_AURA_REMOTE_CONTEXT_CHARS=24000`. The direct provider adapter rejects prompts above 12,000 UTF-8 bytes on local endpoints, and above 48,000 bytes on remote providers. These are conservative input guards, **not** claims about a model's advertised token context. Do not raise local limits to fix an actual 4k-token model-window error; configure the model server context first and verify device stability.

The chat has its own HTTP request, but mission and chat calls may still contend for the same underlying model GPU/CPU. Physical concurrent inference, stop/steer durability, wall-clock response latency and crash recovery require target-host acceptance.

## Explicit mission-control messages

In the conversation, the operator may send **Stoppa uppdraget** / **Stop current mission**, or **Ändra uppdraget: <instruction>** / **Steer mission: <instruction>**. The UI recognizes only these explicit commands; questions or broad conversation never trigger mission mutation. The action invokes the existing authenticated stop/steer control plane, not the chat LLM. With multiple active missions the UI refuses an ambiguous command; the operator must select the intended mission. An accepted steer takes effect at the next safe planning boundary, and stop acknowledgement is not an execution-complete receipt.
