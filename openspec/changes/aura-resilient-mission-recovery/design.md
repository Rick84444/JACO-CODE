# Design: one Aura runtime, two existing recovery mechanisms

## Ownership
- Native mission run: `agents/lib/agent-loop.mjs` and `agents/hands-off-agent.mjs`.
- Durable authority and receipts: `NovaMissionControl` and `DurableMissionBus`.
- Bounded graph repair: `gateway/src/seer-autonomy-loop.mjs` and `seer-mission-graph.mjs`.
- Temporary health classification: `agents/lib/mission-health-policy.mjs`.

## Transitions
- A native model emitting no actionable calls despite bounded nudges yields `STRUCTURED_PLANNER`. The existing structured planner runs on the same selected provider and mission with identical authority.
- A graph mission repeating an identical action after a nudge submits `NOVA_REPLAN_REQUEST` with `subgoals: []`. Empty means repair the failed node in place via the existing graph repair planner, *not* invent a split of its coding contract. The durable controller moves this mission to BLOCKED for graph reconciliation; SEER turns it into a replacement node under the original contract and max-replan budget. For standalone missions native loops yield to the structured planner instead.
- Transient preflight transport outages defer, not end the mission. Identity and authentication failures do not qualify.
- A durable release failure is `WAIT_RUNTIME`, never a fabricated completed/blocked/replanned event.

## Evidence and falsifiers
- A repeated native call on a graph mission with a stable verified receipt creates one replan event with empty subgoals.
- The graph uses its existing fallback strategy, preserving scope, budget, validation and dependency ownership.
- A non-graph mission cannot request the graph repair.
- No forbidden tool, spend, auth issue, uncertain effect or operator cancellation is auto-replayed.
- Every deferred turn releases its planning lease without creating new authority.

## Impacted call graph
`hands-off-agent.runBrain` -> `runAgentLoop` -> `runAgentMission` -> `MissionClient.release` -> `NovaMissionControl.release` -> `DurableMissionBus` -> `seer-mission-graph.reconcile` -> `seer-autonomy-loop.proposeRepair`.
Also `runCodingPreflight` -> `NovaMissionControl.preflight`.

## Risk
Auto-replanning consumes graph budget. Exhaustion stays terminal to prevent infinite loops. The fallback structured planner can itself fail; no fabricated retry or completion is permitted. Windows and paid/local provider behavior cannot be established from GitHub source.
