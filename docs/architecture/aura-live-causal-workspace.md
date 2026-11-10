# Aura Live: causal workspace architecture

Status: [REAL] source-backed implementation slice; [SPEC] target architecture; [UNKNOWN] Windows deployment and complete end-to-end acceptance.
Owner: Aura, the one primary agent. This document defines presentation and evidence contracts; it creates no additional agent, model runtime, planner, tool registry, memory store or control plane.

## Purpose and non-goals

Aura Live must be the observable work surface of JACO's existing execution, not a demo, a tool simulator, or a second IDE. Preserve the canonical dark theme, one chat, existing editor/preview, Gameboard, Mission Bus, MCP, CDP, approvals and operator ownership.

Deliver useful state, not animation: what is being changed, why the action belongs to a goal, what actually ran, what failed, what evidence exists, what should be inspected next, and which verified experience can be reused.

Do not claim private chain-of-thought access. Human language is the agent's reported intent plus deterministic summaries of evidence-backed events.

## Ownership map

| Concern | Canonical owner | Aura Live responsibility |
| --- | --- | --- |
| Goal, mission and approvals | Existing operator control and Mission Bus | Read and navigate; never grant authority |
| Planner graph and node status | Existing mission graph (historical SEER filenames are not an agent) | Associate tool actions with verified graph nodes |
| Tool execution | Existing Aura executor and MCP/CDP/terminal boundaries | Observe tool start and result, never replay |
| Durable results | Mission Bus, receipts, existing evidence inspectors | Show source references, dates and verification state |
| Code/edit/save | Existing workspace file API and Monaco | Render real file, diff and preserve dirty drafts |
| Browser | Existing CDP bridge | Show observed frames with source and capture age |
| Memory and skills | Existing memory and skill systems | Link only verified outcomes; never promote a skill from UI alone |
| Visual placement | Live presentation projection | Recommend and pin surfaces, strictly read-only |

## The causal relation graph

Model links as *references* over existing stores, not new mutable copies of mission truth.

Operator goal -> strategic graph -> graph node -> mission -> action -> tool capability
action -> observed resource -> artifact revision -> verification receipt -> graph reconciliation
verified outcome -> learning record -> knowledge object / reusable skill (separate runtime path)

Required causal edges:
- requires: node -> dependency node
- executes: mission -> action, action -> capability/tool
- touches: action -> typed resource reference
- produces: action -> artifact revision (hash and workspace scope)
- verifies: test/check -> artifact revision
- substantiates: receipt -> node conclusion
- changes_plan: graph revision -> superseded node
- learned_from: knowledge object -> verified outcome (never a proposed plan)

Never infer "produced", "tested", "verified" or "learned" from a model's narration, a registered tool, or the presence of a file path alone.

### Identity and provenance rules

1. Workspace/project: durable project ID and revision (missing in parts of the current event stream; P1 blocker for cross-project history).
2. Graph: graph ID, revision, node key. A node maps to the mission via existing parent metadata.
3. Mission/action: existing mission ID and action ID; an action started and an action finished must match by these IDs.
4. Tool: actual executed tool type and capability registry owner; registration is not execution.
5. Resource: canonical repo-relative path or authorized browser target, content hash/revision where available; never untrusted arbitrary URL.
6. Result: receipt ID/reference, durable sequence, observed timestamp, outcome and verifier.
7. Display: panel identity plus operator pin/focus preferences, always subordinate to observed execution truth.

The current vertical slice exposes bounded tool type and existing parent graph/node identity in CognitiveLive. It does not yet add durable project identity, artifact-revision lineage or full stdout/stderr capture.

## Causal activity state machine

Reported start: OBSERVED_START. Only if the SSE stream is live and the observation is fresh may presentation say RUNNING. Otherwise it says NO_RECENT_OBSERVATION or OBSERVATION_INTERRUPTED, never success or failure.

Receipt: VERIFIED, UNVERIFIED, FAILED or UNKNOWN according to the existing evidence contract. Receipt verification of a single tool step does not verify the whole mission or product.

Graph: node VERIFIED only via the existing graph reconciliation and evidence references. A plan drawn on the Gameboard is not proof of execution.

The initial projection tracks simultaneous actions by mission ID plus action ID. Within a surface, it shows the currently important action and allows inspection of additional actions. It does not execute tools, persist competing mission state or invent unseen actions.

## Presentation policy

Surface types: code, browser, terminal, tests, Git and tools.
A bounded, explainable selection algorithm ranks current execution, failures/uncertainty and verified outcomes. Prefer causally relevant resources and tests over repetitive read traffic.

A user's pinned surface has display priority, never higher execution priority or extra permissions. Do not steal focus while a user edits, reviews a diff or responds to a human gate. Keep concurrent surfaces visible. Respect reduced-motion settings and mobile width.

Surface labels are observation claims. "Running" requires a recent real action start and current stream; "Verified result" requires a compatible receipt; "Tool available" is not "tool executed".

The existing full terminal and editor remain canonical. Current CognitiveLive events intentionally omit raw tool inputs and full stdout/stderr; the visual tool trace must not falsely claim to replace a complete shell. A future detailed terminal channel should use a bounded, authenticated, redacted, per-action log resource, never stream credentials to the general SSE feed.

The existing CDP image is a timestamped screenshot, not video. Future live browser updates can increase observation fidelity only after measuring performance, target provenance and resource budgets.

## Aura self-awareness and dynamic evolution

Aura may query existing read-only current-work and mission-graph tools to inspect the same causal references as the operator. The UI projection is not a new reasoning service, and presentation state must never be treated as authoritative task completion.

To become better at future work rather than accumulate screens:
1. Record the problem, selected solution, assumptions and expected verification.
2. Execute through the existing tool/mission contract.
3. Compare the expected effects with verified receipts, code diffs and test results.
4. Attribute outcome to artifact revision and graph node.
5. Persist meaningful, provenance-bound learning through the existing memory/skill lifecycle.
6. On a similar task, retrieve candidates and counterexamples; benchmark new alternatives before promoting a preferred skill.

Initial UI implementation proves only the observation surface and graph links, **not** that this autonomous improvement loop is completed. Tool contract enrichment, artifact provenance, read-only causal query integration and memory promotion are separate P1/P2 implementation gates.

## Performance and reliability constraints

- No second WebSocket/SSE transport when existing CognitiveLive suffices. Respect background-tab connection management.
- No extra LLM calls to decide which window to render. Use a deterministic client-side projection.
- Cap rendered panels and action history; use detail fetch by action ID for large logs.
- Ignore out-of-order volatile duplicates when a durable receipt exists.
- On disconnect or stale events, degrade observation state, not execution evidence.
- Hide or invalidate material on project switching; durable project scoping remains to be completed.
- A preview is read-only or uses the existing hash-checked save and sandboxed HTML preview.
- A missing or failed MCP/CDP/tool receipt cannot be synthesized from a model's text.

## Acceptance gates

### Gate A — source and contract
- Same canonical JACO GUI, single Aura; no new planner, policy engine or tool registry.
- Event stream provides bounded tool identity and parent graph/node IDs when they actually exist.
- Mission/action matching is stable under simultaneous operations and replay.
- Gameboard highlights all concurrently active paths, not only the first.

### Gate B — integration and semantics
- Start two different tools in one mission: both surfaces appear without user navigation.
- Start two tools of the same kind: retain both action IDs; never collapse into fake success.
- A failure remains failure despite a previous green result.
- Disconnect, stale stream and unknown external effect are shown distinctly.
- Live tool can open the exact graph node that assigned the mission.
- Pinned or unsaved work is never replaced by automatic selection.

### Gate C — deeper runtime loop (not delivered in the initial slice)
- Read-only structured causal query for Aura over existing mission, graph and artifact owners.
- Real per-action command, stdout/stderr and test resource detail with access control.
- Durable project ID in replay/selection, not timestamp cutoffs.
- Multi-file diff and concurrent browser/test panes with source/age labels.
- Verified skill/memory feedback tied to measured effects and failures.

### Gate D — product acceptance
- CI TypeScript, client/server build, affected Node tests and real browser scenarios green.
- Run a non-mocked mission on the operator's actual Windows install: edit code, execute test, inspect receipt, open graph node, switch projects and reconnect.
- Capture release version, source SHA, provider/model, OS, test names, measured result and remaining failures.
- Operator's hands-on review is required; neither a UI screenshot nor green mocks substitute for it.

## Red-team review outcomes

1. **Trap: UI as executor.** Rejected. Presentation has no authority to initiate work or change mission truth.
2. **Trap: single newest item.** Rejected. Parallel tools use stable action IDs and multi-surface projection.
3. **Trap: two sources of truth.** Rejected. Existing mission receipts and graph reconciliation are authoritative; GUI offers read projections.
4. **Trap: stale equals running.** Rejected. Freshness and stream health are independent from verification state.
5. **Trap: overly broad implementation.** Rejected. Deliver vertical slices against the existing GUI and CI before expanding to knowledge graphs or new protocol plumbing.
6. **Trap: static visualization.** Rejected. Surface selection and graph links must react to each real event; later learning requires verified closed-loop outcomes, not decorative telemetry.

## Implementation map

Initial vertical slice:
- runtime/src/lib/liveWorkspaceProjection.mjs — deterministic read-only multi-surface projection
- runtime/src/lib/cognitiveEvents.mjs — bounded executed tool identity and plan-node fields
- runtime/src/server/connected/cognitiveLiveStream.mjs — durable mission parent graph/node correlation
- runtime/src/hooks/useCognitiveLive.ts — typed event context, existing SSE transport
- runtime/src/components/AuraLiveToolSurfaces.tsx — live cards under human narration
- runtime/src/components/AuraLiveStage.tsx — preserve existing stage and integrate cards
- runtime/src/components/JacoAuraComputeIDE.tsx — bridge to existing Gameboard without a new control plane
- runtime/src/components/StrategyBoard.tsx — parallel active paths, blue pulsating active edges
- tests/nova/live-workspace-projection.test.mjs, tests/nova/cognitive-live.test.mjs, runtime/src/lib/gameboardTree.test.tsx — regression tests

Prohibited in this change: registering a new agent, simulating tool runs, granting new permissions, writing memory based on GUI status or asserting installation/runtime verification from source inspection alone.
