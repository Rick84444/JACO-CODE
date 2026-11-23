# Design: bounded recovery in the canonical Aura runtime

## Context
The existing Mission Bus owns executable state and receipts, the native agent loop owns model interaction, and the graph repair loop already implements capped failure repair. The proposed change links these existing capabilities rather than adding a parallel runtime.

## Goals / Non-Goals
Goals: recover transient provider and tool transport outages, switch tool-call protocols when necessary, and autonomously replan known graph stalls while preserving durable evidence.
Non-goals: bypass approvals, widen tools or budgets, retry unknown external side effects, infer success, replace a selected provider, or create new mission/state stores.

## Decisions
1. Native non-actionable turns produce `STRUCTURED_PLANNER` after the existing bounded nudges. The existing structured path continues with the current mission and provider.
2. Repeated graph-mission tool loops produce an empty-subgoals `NOVA_REPLAN_REQUEST`. The graph's existing safe repair planner rewrites one node using the original contract and bounded repair count. Empty means repair in place, not split.
3. Standalone native stalls use the structured protocol. A non-graph replan request is rejected at the mission control boundary.
4. Transport-only preflight failures defer. Authentication, identity and invalid workspace errors remain blocking.
5. Failed planning-lease release returns `WAIT_RUNTIME`, not a false blocked/replanned success.
6. Model downtime after completed actions preserves receipts and returns `WAIT_PROVIDER`.

## Risks / Trade-offs
Repair attempts consume the original graph budget and may exhaust. A structured planner can also fail; the system must report a genuine irrecoverable blocker rather than fabricate progress. Pending/pause/cancel/unknown-outcome rules remain unchanged.

## Impacted Call Graph
`hands-off-agent.runBrain` -> `runAgentLoop` -> `runAgentMission` -> `MissionClient.release` -> `NovaMissionControl.release` -> `DurableMissionBus` -> `seer-mission-graph.reconcile` -> `seer-autonomy-loop.proposeRepair`.
Preflight: `runCodingPreflight` -> `NovaMissionControl.preflight`.

## Verification
Tests cover protocol recovery, graph and non-graph authority, failed durable release, temporary health and identity exclusions, preservation of receipts and SEER repair contract. CI results are tied to the exact commit SHA. No Windows target-host claim without an observed installed run.
