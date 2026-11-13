## Purpose

Aura SHALL recover bounded technical stalls through its existing runtime without escalating authority, fabricating evidence or requiring unnecessary operator intervention.

## ADDED Requirements

### Requirement: Native protocol degradation
Aura SHALL switch to the existing structured planner on the same selected provider and ACTIVE durable mission when the native tool protocol becomes unproductive.

#### Scenario: Repeated non-actionable model replies
- **WHEN** the selected model returns repeated text-only answers without actionable native tool calls
- **THEN** the native loop SHALL release its planning lease and request `STRUCTURED_PLANNER`
- **AND** the mission SHALL remain ACTIVE without new permissions

#### Scenario: Refused completion followed by text-only loops
- **WHEN** a model repeatedly proposes completion without meeting contracted verification
- **THEN** Aura SHALL attempt the structured planner instead of consuming repeated failed mission turns

### Requirement: Bounded graph repair
Aura SHALL hand confirmed native tool loops in graph missions to the existing capped SEER repair mechanism, preserving original contract authority.

#### Scenario: Repeated unchanged tool calls
- **WHEN** an ACTIVE graph mission repeats an unchanged known-outcome action after a bounded nudge
- **THEN** Aura SHALL persist a `NOVA_REPLAN_REQUEST` with empty subgoals for in-place repair
- **AND** the graph controller SHALL preserve contract scope, budget and dependencies

#### Scenario: Graph repair budget exhausted
- **WHEN** the existing bounded graph repair exhausts its allowed attempts
- **THEN** the graph SHALL remain terminal with evidence instead of looping

### Requirement: Standalone mission recovery
Aura SHALL never request a graph repair for a mission not owned by a graph.

#### Scenario: Standalone native loop stalls
- **WHEN** a standalone mission repeats a known-outcome native action
- **THEN** Aura SHALL switch to the structured planner without inventing a graph or new mission

#### Scenario: Unauthorized graph replan request
- **WHEN** a non-graph mission sends `NOVA_REPLAN_REQUEST`
- **THEN** the durable controller SHALL reject it without broadening its authority

### Requirement: Transient infrastructure preflight
Aura SHALL defer exclusively transport-unavailable preflight blockers and SHALL NOT misclassify authorization or identity failures as health conditions.

#### Scenario: Browser bridge temporarily unreachable
- **WHEN** the required browser health probe fails because of transport unavailability
- **THEN** Aura SHALL defer the mission for the existing health/scheduler cycle

#### Scenario: Browser authorization denied
- **WHEN** the required browser health probe receives HTTP 401 or 403
- **THEN** Aura SHALL retain an authorization blocker rather than automatically retry it as health

### Requirement: Durable release truthfulness
Aura SHALL NOT report a graph repair, completion or blocking state as persisted if the durable release failed.

#### Scenario: Replan release fails
- **WHEN** the existing Mission Bus release endpoint rejects or fails the replan transition
- **THEN** the agent SHALL report `WAIT_RUNTIME` without claiming a submitted repair

### Requirement: Model outage after progress
Aura SHALL preserve verified work and keep an ACTIVE mission retryable when a selected provider becomes temporarily unavailable after tool execution.

#### Scenario: Provider lost after a verified action
- **WHEN** one or more tool receipts have been persisted and the provider returns transient unavailability
- **THEN** Aura SHALL defer with `WAIT_PROVIDER` without discarding receipts or blocking the mission

### Requirement: Immutable authorization boundaries
Aura SHALL respect operator stop, pause, denied capabilities, explicit spending gates and uncertain external side effects during any automated recovery.

#### Scenario: Authorization or unknown outcome
- **WHEN** a failure requires explicit human authority or a previous external effect is unknown
- **THEN** Aura SHALL not retry the affected mutation or widen the contract under a recovery classification
