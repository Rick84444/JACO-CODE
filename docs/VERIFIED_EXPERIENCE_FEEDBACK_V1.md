# JACO Verified Experience Feedback — first Level 2/3 slice

Status: implemented on a review branch; runtime and target-host verification remain pending.

## Scope

This slice reuses the canonical `KnowledgeStore`, `EvidenceLedger` and `CognitiveContinuityRuntime`.
It does **not** add a memory service, train a model, change scheduler authority, or enable new tools.

### Level 2 — evidence-gated experience retrieval

A Continuum planning envelope now includes up to five task-relevant experience records.
Candidate records must be explicitly reusable, VERIFIED, backed by currently verified evidence,
and relevant to the current objective or attention. Knowledge tied to an outdated repository
snapshot is omitted. Rejected / falsified hypothesis proposals are not recommended as skills.
Nova retains this bounded projection through `compactContinuityForBrain`.

Memory remains **advisory, not instructions or permissions**. The same coding contracts,
tool boundaries, runtime policy and approval checks continue to apply.

### Level 3 — first closed feedback boundary

When a once-verified lesson becomes `CONTRADICTED`, `SUPERSEDED`, `STALE` or `INVALID`
in canonical knowledge state, the next envelope no longer recommends it. A subsequent
independently evidenced replacement can become eligible. Retrieval remains read-only
and persists across an EventStore restart; promotion/invalidations are performed by
existing evidence and knowledge owners.

This proves a **selection and revision mechanism**, not autonomous improvement in
model reasoning quality or developer productivity. Claims of improved skill require
a controlled, external holdout benchmark.

## Reproducible tests

```bash
cd runtime
node scripts/continuum/cognitive-continuity-runtime.test.mjs
npm run test:continuum-runtime
```

The focused suite checks baseline (no lessons), rejected unverified evidence,
verified reusability, repository revision mismatch, falsification exclusion,
contradiction, replacement and restart reconstruction.

## Next controlled experiment

1. Create an independent set of repository-fixing tasks with hidden acceptance tests.
2. Use the **same** provider/model, fixed configuration and comparable call budgets.
3. Randomly assign matched tasks to `no experience` vs `verified experience`.
4. Measure solved rate, false-success rate, tokens, elapsed time and regression count.
5. Repeat with a verified new lesson and with an intentionally contradicted lesson.
6. Never train or promote based on held-out test answers; report confidence intervals.
7. Promote Level 2 only on measured holdout gain and Level 3 only if feedback improves
   later unseen outcomes without unbounded regressions.

## Limitations

- Retrieval is simple lexical matching, not graph-semantic or vector retrieval.
- A VERIFIED evidence record is only as reliable as its independent verifier.
- Synthetic fixtures in automated tests prove software contracts, not field effectiveness.
- Live Nova planner behavior, Android/Windows restart and actual task success have not yet
  been measured for this change.
