# Cognitive Gameboard: Intuition and backward dependencies

## Product authority

The operator's original intuition is the durable goal. JACO is the system; Aura is the sole primary agent. SEER's existing mission graph owns planning, and the existing Aura runtime owns execution, approval and evidence. The Gameboard visualizes these states read-only; it never executes actions or creates another mission runtime.

The original desktop UI remains the canonical JacoAuraComputeIDE on both Windows and laptops.

## Architecture and behavior

- Operator intuition is preserved in the graph policy as intuition_id and intuition_statement. Existing graphs fall back to their original objective; historical snapshots are never rewritten.
- The preexisting SEER mission graph owns the persisted DAG, node identity, dependency edges, replan history, validation and actual evidence references.
- The plan view exposes those persisted references without synthesizing receipts.
- ReverseGoalLayout draws the root at the top, with prerequisite stages below their consumers. Shared dependencies appear once, with multiple incoming edges.
- White means not running. Soft pulsing blue connects the current observed work back to the root. Solid blue requires VERIFIED state and a persisted evidence reference. Claimed completion without reference is displayed as unconfirmed.
- Existing StepCard, GoalCard, approval center, operator comments, plan history and local memory remain available.
- The board follows the active graph by default. Selecting a historical graph explicitly pins it.
- The board reuses the existing Aura live SSE stream and refreshes from the plan source; no additional SSE connection, model or tool grant.
- If SEER or live stream is unavailable, the last observed graph remains visible but active pulses stop. No simulated work is displayed as real execution.

## Independent perspectives implemented as automated tests, not extra AI agents

Senior adversarial checks: tests/nova/reverse-goal-layout.test.mjs and tests/nova/aura-plan.test.mjs. These cover cycles, unknown links, duplicate identities, shared prerequisites, false verification, stale execution, replan anchoring and operator authority.

Simulated user journey: tests/nova/cognitive-workspace.browser.mjs uses real Playwright browser actions against a controlled durable Mission Bus fixture. The test opens the canonical GUI, navigates Gameboard, validates centering, clicks steps, zooms, collapses dependencies, observes changes on evidence events and confirms browsing never starts another mission.

Windows packaging: .github/workflows/jaco-windows-release.yml now triggers for Gameboard changes, tests DAG logic, builds the production GUI and executes install/launch/reinstall/uninstall smoke tests.

## Known scope limitations (do not mark fully verified)

- Project-mode coding missions currently start with one coarse SEER implement node and use Nova's existing internal coding breakdown. A truly deep automatically evolving project tree additionally requires those internal planned steps to be persisted as SEER mission-graph nodes. Do not invent them in the UI.
- Green GitHub browser tests and Windows installer CI are not equivalent to a real Windows deployment with the user's chosen LLM provider, credentials, local tools, live mission execution, restart and recovery.
- Large graphs over 240 nodes or 1200 edges show an error rather than silently truncating or fabricating.
- A graph revision does not authorize a change of the user-controlled intuition, spending, tool access or policy.

## Acceptance

All final-commit checks must be green, including full GUI/browser, unit DAG and Windows installation. Reverify the actual local PC process and model connectivity before claiming production-grade hands-off autonomy. CI artifacts are not necessarily published as stable releases.