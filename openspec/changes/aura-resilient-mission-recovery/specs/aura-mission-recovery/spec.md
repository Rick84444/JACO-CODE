# Aura mission recovery — delta specification

## Requirement REC-001: Native protocol degradation
WHEN an ACTIVE mission's selected model emits repeated non-actionable native responses
THEN Aura SHALL release its planning lease and use the existing structured planner on the same selected provider and durable mission.
AND it SHALL NOT create a new mission, change tools, spend or consume failed-action budget solely for a protocol failure.

## Requirement REC-002: Durable graph recovery
WHEN a graph mission has repeated an unchanged tool action after a bounded recovery nudge, with no unknown side effect
THEN Aura SHALL submit a durable `NOVA_REPLAN_REQUEST` and let the graph controller repair the failed node.
AND the repair SHALL preserve original scope, budget, acceptance and operator controls, subject to the existing graph retry limit.

## Requirement REC-003: No unauthorized graph repair
WHEN a standalone or non-graph mission attempts to request graph replan
THEN the durable controller SHALL reject it without changing the mission or escalating privileges.

## Requirement REC-004: Infrastructure preflight
WHEN a required service fails because of transport unavailability
THEN Aura SHALL defer and retry after the health/scheduler cycle without operator approval.
WHEN the failure indicates authentication, invalid identity, missing files or policy denial
THEN Aura SHALL NOT classify it as automatically recoverable.

## Requirement REC-005: Truthful durable release
WHEN a lease release or replan request fails
THEN Aura SHALL NOT report success or a submitted replan without a durable runtime acknowledgement.

## Requirement REC-006: Bounded autonomy
WHEN the operator pauses, cancels, revokes permissions, or a previous action has an unknown effect
THEN automated recovery SHALL honor the existing runtime boundaries and SHALL NOT replay uncertain side effects.
WHEN the graph exhausts its bounded replans
THEN it SHALL remain exhausted with explicit evidence instead of silently looping.
