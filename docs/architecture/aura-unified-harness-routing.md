# Aura harness: one operator model, existing execution owners

This increment unifies **model selection**, not process ownership. Aura is the
single operator-facing identity; the SEER strategic planner and the Nova local
executor retain their durable mission, lease, tool and evidence responsibilities.

## End-to-end selection

When an operator explicitly chooses a provider/model in Aura chat and starts
**Full Autonomous**, the chat sends `harnessModel:{providerId,model}` with the
existing `/api/aura/workbench/start-goal` request.

Core uses the existing connected-provider registry and
`validatePlannerChoice` to check that exact model. A new selection is checked by
the existing `testPlannerModel` implementation (metered providers reserve and
settle through Continuum); failed/blocked probes do not change the preference.
The same `.jaco/state/provider-preference.json` is atomically replaced before
goal dispatch. No model, tool, budget or policy service is added. The goal
response records the synchronized model but distinguishes the text probe from
verified tool calling.

SEER's inference path and Nova's native and schema-based planners read the same
saved preference. An explicitly operator-pinned model must **not** silently
fall back to an unselected model if it fails or cannot call tools. The job
remains unexecuted (or is deferred/blocked) and displays a real blocker instead
of claiming execution with a different model. Without an explicit selection,
legacy automatic model fallback remains. `JACO_PRIMARY_PROVIDER` is higher
authority than the GUI and causes an explicit conflicting selection to be
refused; selecting **JACO standard** in the chat does not overwrite it.

The operator model is the model **identity**, not a promise of independent
parallel inference. The chat stays responsive to operator input while a
mission works, but a resource-constrained single-model backend can queue its
actual generation.

## Durable authority boundaries

Existing mission data remains in the canonical SQLite mission bus. The
`NOVA_OPERATOR_STEER` revision fences tool starts; running actions finish
and emit their original receipts. Nothing here modifies those responsibilities
or attempts to copy the mission ledger into chat state.

## Verification and scope limit

Unit tests cover validation, explicit environment authority, failed provider
probe, pinned candidate selection, shared preference path, atomic write and
legacy behavior. CI checks build/contracts. Device-level proof still needs
an actual Windows and Termux run with a selected provider, a mission, steering,
restart and real tool receipts.

Remaining work: one durable chat-request identity/recovery contract, and
convergence of legacy JSON planning and native function calling behind a
capability-driven model adapter. Native tool support cannot be inferred from
a successful plain text completion.
