# JACO NEXUS causal state contract

This package moves NEXUS state from caller-managed events to a runtime-owned
causal contract.

## Boundary

JACO code emits semantic deltas through `runtime.emit_delta(...)`.

The runtime owns:

- event identity
- replica sequence
- membership epoch
- WAL durability ordering
- causal frontier
- checkpoint/recovery
- duplicate suppression
- replica merge

`RuntimeFacade` adapts older ZTP-PLSM builds that only expose `emit(Event)`.
That path persists its producer cursor before emission so restarts never reuse a
local sequence. Full cross-replica event identity still requires the modern
`emit_delta` runtime contract.

## State invariants

1. A process restart must not reuse a local producer sequence.
2. Replaying the same event must be idempotent.
3. Checkpoint + WAL tail must recover the same materialized state as live state.
4. Replicas that ingest the same event set must converge.
5. OR-Set remove only removes adds observed by that remove operation.
6. GCounter-backed fields never decrease.
7. Legacy JSON migration must not double-count counters when repeated.
8. Unknown NEXUS agent fields fail closed instead of silently disappearing.

## Verification without ztp_plsm

`reference_runtime.py` is a disk-backed contract runtime used only to verify
semantics when the production/private ZTP package is unavailable. It includes
an fsync'd JSONL WAL, persistent local sequence, checkpoints, recovery,
deduplication and replica ingestion.

Run:

    python tests/test_state_integration.py

The reference runtime is not a replacement for production ZTP-PLSM. A second
acceptance gate should run the same contract against the real
`EnterpriseRuntime` when that package is present.
