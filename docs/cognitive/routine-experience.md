# Routine experience and deterministic execution roadmap

Aura has one authority boundary: the current mission, its allowed tasks, its
operator contract and the existing execution gates. Receipt-derived experience
is advisory. It cannot change a scope, grant an MCP write, approve an action,
increase a budget, or establish a new mission's outcome.

## Implemented in this change

- Reuse the existing mission-outcome journal, not a second knowledge database.
- Record an ordered read/observation sequence only for a DONE mission whose
  answer was checked (and whose coding contract, if any, was machine-verified).
- Store only tool kinds, hashed scope/goal tokens and source receipt identifiers;
  no selectors, screen coordinates, command strings or form values.
- A fixed local recovery rule may be recalled after a concrete known refusal.
  Record historical recovery observations only when the surrounding verified
  observations have the same scope. An observation does not prove a repair.
- Require a fresh observation of the current scope for historical reuse. Filter
  against the active planner's attenuated task list. Missing memory cannot stop
  a valid mission. No LLM is needed to derive this advisory memory.
- Do not generate a separate skill approval card for an observation-only
  procedure already represented here. Executable/model-written skills and
  outward mutations retain their existing review path.

## Next execution layers (not implemented here)

1. **Persistent bridge**: reuse the existing Phase Integrity Gate (PR #324),
   not a second input authority. PR #324 is merged; validate the integration on current main. Add a versioned local NDJSON codec with request
   IDs, deadlines, cancellation, one in-flight mutation, bounded frames, no
   automatic mutation replay after disconnect, and receipt correlation. Measure
   cold start and warm dispatch separately. A 15 ms p95 warm target is a
   hypothesis; no hard-real-time Windows guarantee.
2. **Playbook compiler**: start with a closed list of read-only primitives.
   A playbook must bind a current operator-selected goal and typed parameters
   to semantic anchors, ordered predicates, per-step budget and current scope.
   No argument copying from historical receipts. Each actual step must use
   the existing claim/begin/finish authority and produce a fresh receipt.
   Never skip a guard, use entropy as postcondition proof, or replay an unknown
   mutation. Abort to the existing planner on invalidation. Only add mutation
   primitives with independently tested pre/postconditions.
3. **MCP**: expose the very same guarded executor, read-only discovery by
   default. Mutation calls must present a current mission/action binding and
   go through the existing policy; no raw OS injection escape hatch.
4. **Chaos Gauntlet**: compare an unguarded baseline with the guarded engine
   on isolated browser/Win32 fixtures (target swap, focus theft, inert control,
   DPI change). Publish raw per-trial outcomes, wrong-target rate, safe abort
   rate, expected-effect success, p50/p95/p99 latency, and token/model-call
   counts. Fix seeds, disclose hardware, OS, DPI setup and sample size. A zero
   observed wrong-click result is not a guarantee of zero future failures.

A 50 ms per-step target applies only to bounded local primitives, not network,
application startup, human interaction or UI settling. Do not equate 100 Hz
sampling with verified 100 Hz action delivery. Marketing claims must follow
measured results. No publishing, external outreach or deployment is initiated
by this change.
