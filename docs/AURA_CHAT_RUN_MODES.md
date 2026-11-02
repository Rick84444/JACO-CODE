# Aura Chat: Manual, Planning, Full Autonomous and Build Agent

This is **one** JACO GUI inside the browser and the VS Code full-GUI extension. No second agent, planner, permission registry or model process was created.

## Operator experience

The composer displays **only the selected execution mode**. Clicking its text opens a small inline choice between:

| Mode | Dispatch | Changes and tools |
|---|---|---|
| **Manual** (default) | `POST /api/aura/chat` with `interactionMode:question` | Read-only cognitive conversation; never creates a mission |
| **Planning** | `POST /api/aura/chat` with `interactionMode:planning` | Read-only tools and verified knowledge/skill metadata, no new mission, no policy update |
| **Full Autonomous** | Chat: `POST /api/aura/chat` with `interactionMode:question`. Explicit **Start mission**: `POST /api/aura/workbench/start-goal` with `executionMode:autonomous` | Conversation remains read-only while the existing durable mission runs. Start, stop and steer are separate operator actions with existing mandates. |

The active Full Autonomous label glows/pulses softly blue and respects `prefers-reduced-motion`. Selecting a mode never starts work; pressing Send is the explicit dispatch. No `window.confirm` popup appears merely for switching modes. After submitting a mission the selected mode stays Full Autonomous, so the operator can continue the conversation and steer or stop the running work. **Send** always sends a chat message; **Start mission** is a separate button and never an implicit side effect. Full Autonomous is **not** restored from browser storage on reload.

Clicking **Build Agent** opens a compact form inside the conversation. Typing `build agent` in the Manual/Planning composer does the same. Name, role, responsibility, success criteria and an operator credential are supplied to the **existing** `POST /api/aura/organization/agents`. A successful record is under Aura, with `L1`, no permissions, no paid model budget, no started worker and no invented communication identity. Its token is only held in component memory, not localStorage. No autonomous model output can bypass the operator-authenticated endpoint by claiming to be the operator.

## Knowledge and Skills

For each chat turn, the backend uses existing **Continuum KnowledgeStore** and **Skill Runtime** to retrieve compact candidates. Only evidence-backed `verificationStatus: VERIFIED` knowledge and `status: ACTIVE` skills are included in this optional, read-only context. Invalid/stale facts, candidate/retired skills and unavailable catalogs yield no fabricated matches.

The composer can show small live counts for matching verified knowledge and eligible skill candidates. Full details remain in existing Skills/Knowledge views; we do not create another modal or catalog.

**Critical:** discovery is not activation permission. Every skill proposal is explicitly tagged `DISCOVERED_NOT_AUTHORIZED`. Running a skill's procedure requires the current mission, operator-approved scope, per-step tool permission, budget and approval constraints. This PR does **not** claim that `AgentOrganization.decide()` is wired into every Nova and Skill Runtime execution step; that enforcement is the next hardening task. A chat mode cannot override an existing deny.

## Acceptance

- Invalid interaction modes yield HTTP 400, instead of silently changing a command into ordinary chat.
- Manual/Planning use only the read-oriented toolbox; Planning does not include the previously available policy-change exception.
- Full Autonomous keeps chat available, and starts a durable canonical mission only through a separate explicit Start mission button; returns a real acknowledged ID without creating a second executor.
- The default remains Manual on every new session; one single selected-mode label and a subtle pulse in Full Autonomous.
- Build Agent stays within the existing operator-key route; no API key is sent to an LLM, no auto-grant.
- Knowledge must have verified evidence; skill candidates must be ACTIVE, with **no** execution authority inferred.
- Pass contract/unit tests, TypeScript, production frontend/backend build, and target-host browser interaction. CI does not by itself prove local Windows/Termux or VS Code behavior.

## Operator stop from the conversation

The Aura conversation may request cancellation of an observed active mission through the existing `/api/aura/workbench/missions/:id/cancel` route. The runtime keeps its own graph-cancellation and mission-receipt semantics. A successful request confirms that stop was requested, not that an in-flight tool or the complete mission has already stopped. This control is separate from cancelling a chat response. Operator steering within an ACTIVE mission is now available from the same composer through **Ändra uppdrag / Steer mission**. This is an explicit operator-only action; normal Manual/Planning messages remain read-only and Full Autonomous still requires explicit submission. The request is persisted as an immutable `NOVA_OPERATOR_STEER` event with a unique request ID in the existing mission bus, with no second planner or model call.

Each model turn reads the latest steering revision. The existing `begin` boundary rejects an action planned against an older revision (`NOVA_STEER_STALE`) before starting any new tool, and stale completion/replan/blocking proposals are rejected. If an action is already executing, its lease and receipt are preserved; any subsequent batched step must use the new revision. The UI reports **queued for next planning step**, not already applied or verified. No model/plan/contract/permissions/budget changes result from steering, and the original parent graph's acceptance remains authoritative. A fundamentally different goal or expanded scope must be submitted as a new mission with appropriate authorization. Steering is not yet a generalized graph-node rewrite, and real device/provider tests remain necessary.

## Context limits and interactive latency

The chat uses the existing primary model selection directly when it is registered, without an extra SEER planning hop. This does not make a shared physical local model concurrently available while another inference is running.

Prompt construction retains the latest instruction and distributes the remaining context among verified observations, recent conversation, repository knowledge and tool receipts. Default user-context budgets: `JACO_AURA_LOCAL_CONTEXT_CHARS=5200` and `JACO_AURA_REMOTE_CONTEXT_CHARS=24000`. The direct provider adapter rejects prompts above 12,000 UTF-8 bytes on local endpoints, and above 48,000 bytes on remote providers. These are conservative input guards, **not** claims about a model's advertised token context. Do not raise local limits to fix an actual 4k-token model-window error; configure the model server context first and verify device stability.

The chat has its own HTTP request, but mission and chat calls may still contend for the same underlying model GPU/CPU. Physical concurrent inference, stop/steer durability, wall-clock response latency and crash recovery require target-host acceptance.
