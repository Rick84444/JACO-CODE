# Cognitive Gameboard: Intuition and backward dependencies

## Product authority

The operator's original intuition is the durable goal. JACO is the system; **Aura is the sole primary agent and the owner of goals, reasoning, planning, execution orchestration and evidence.** The Gameboard visualizes Aura's persisted state read-only; it never executes actions or creates another mission runtime. Former SEER or Nova names refer to compatibility adapters, never independent agents.

The original desktop UI remains the canonical JacoAuraComputeIDE on both Windows and laptops.

## Architecture and behavior

- Operator intuition is preserved in the graph policy as intuition_id and intuition_statement. Existing graphs fall back to their original objective; historical snapshots are never rewritten.
- Aura's persisted mission graph is the source of its DAG, node identities, dependencies, replan history, validation and actual evidence. Its current storage adapter still has legacy SEER filenames and SQLite state for compatibility; see docs/architecture/aura-control-plane-migration-2026-11-09.md. Aura Core controls scheduling through the fenced orchestration lease.
- The plan view exposes those persisted references without synthesizing receipts.
- ReverseGoalLayout draws the root at the top, with prerequisite stages below their consumers. Shared dependencies appear once, with multiple incoming edges.
- White means not running. Soft pulsing blue connects the current observed work back to the root. Solid blue requires VERIFIED state and a persisted evidence reference. Claimed completion without reference is displayed as unconfirmed.
- Existing StepCard, GoalCard, approval center, operator comments, plan history and local memory remain available.
- The board follows the active graph by default. Selecting a historical graph explicitly pins it.
- The board reuses the existing Aura live SSE stream and refreshes from the plan source; no additional SSE connection, model or tool grant.
- If Aura's graph adapter or live stream is unavailable, the last observed graph remains visible but active pulses stop. No simulated work is displayed as real execution.

## Operator controls on the board

The board is the operator's hand on a running mission as well as a view of it. Every control goes through the same
workbench routes as the chat (`/api/aura/workbench/missions/:id/...`); the board grants no authority of its own, and
what it offers is derived from the mission ledger (`missionControlState` in `StrategyBoard.tsx`), never from the goal's
wording.

| Control | Route | Effect | Offered when |
| --- | --- | --- | --- |
| Pause | `pause` | No new planning lease, no new tool; a running step finishes and keeps its receipt; later missions are not held up; survives a restart | mission ACTIVE and not paused |
| Resume | `resume` | Lifts the pause only; a blocker still needs its own decision | mission paused |
| Send a change | `steer` | Recorded as a steering revision; Aura reads it at her next planning step; a plan made before it cannot start a tool after it | mission ACTIVE |
| End the mission | `cancel` | A running step may finish, nothing new starts, the goal stays | mission not already ending |
| End the goal | `end-goal` | Ends the strategic goal, stops its open graphs and their missions | mission belongs to a graph |

Pause and resume are recorded as `NOVA_OPERATOR_PAUSE` / `NOVA_OPERATOR_PAUSE_END` events on the mission bus
(`novaMissionControl.mjs`: `pause`, `resumePaused`, `pauseState`). The operator's own "continue" on a blocked mission
also lifts a pause; an automated resume from the approval policy never does. Ending is confirmed in place, with its
effect spelled out, before anything is sent. Contract: `tests/nova/mission-pause.test.mjs` and
`runtime/src/lib/gameboardTree.test.tsx`.

## Independent perspectives implemented as automated tests, not extra AI agents

Senior adversarial checks: tests/nova/reverse-goal-layout.test.mjs and tests/nova/aura-plan.test.mjs. These cover cycles, unknown links, duplicate identities, shared prerequisites, false verification, stale execution, replan anchoring and operator authority.

Simulated user journey: tests/nova/cognitive-workspace.browser.mjs uses real Playwright browser actions against a controlled durable Mission Bus fixture. The test opens the canonical GUI, navigates Gameboard, validates centering, clicks steps, zooms, collapses dependencies, observes changes on evidence events and confirms browsing never starts another mission.

Windows packaging: .github/workflows/jaco-windows-release.yml now triggers for Gameboard changes, tests DAG logic, builds the production GUI and executes install/launch/reinstall/uninstall smoke tests.

## Known scope limitations (do not mark fully verified)

- Project-mode coding missions currently start with one coarse Aura mission-graph implementation node and use the existing coding-execution capability for internal breakdown. A truly deep automatically evolving project tree additionally requires those internal planned steps to be persisted as Aura mission-graph nodes. Do not invent them in the UI.
- Green GitHub browser tests and Windows installer CI are not equivalent to a real Windows deployment with the user's chosen LLM provider, credentials, local tools, live mission execution, restart and recovery.
- Large graphs over 240 nodes or 1200 edges show an error rather than silently truncating or fabricating.
- A graph revision does not authorize a change of the user-controlled intuition, spending, tool access or policy.

## Acceptance

All final-commit checks must be green, including full GUI/browser, unit DAG and Windows installation. Reverify the actual local PC process and model connectivity before claiming production-grade hands-off autonomy. CI artifacts are not necessarily published as stable releases.
## Legacy code is not a separate agent

The migration of 2026-11-09 establishes one Aura control plane. Modules with older SEER/Nova filenames may still run as storage and execution compatibility services. They must not acquire an independent goal, separate mission scheduler, external authority or a second agent identity. Do not delete those modules or rewrite the persisted SQLite and mission ledger without a tested transactional migration, dual-owner prevention, crash recovery and genuine Windows end-to-end acceptance. The architecture is Aura-only today at the agent/control-plane level; consolidation into one physical operating-system process is still incomplete.
