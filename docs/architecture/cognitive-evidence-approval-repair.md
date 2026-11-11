# Cognitive evidence and approval delivery integrity

## Scope

Market Watch has no independent verifier. It now starts with zero observations,
creates no fallback insight on failed source retrieval, invalid JSON, or provider
failure, and stores successful model analyses only as HYPOTHESIS. Source URL,
retrieval timestamp and SHA-256 identify the retrieved text; they are not proof
of the model's claims. Model-supplied URLs and verification labels cannot replace
this provenance. Confidence stays zero without independent measurements.

The existing planner receives only a count/status of these hypotheses, never
their claims or tactical directives. The existing list API retains them for
separate investigation. Turning injection off returns an empty context.
The scan API propagates actual failure rather than returning success unconditionally.

The existing durable action gate now preserves an identical pending request's
identity/time and emits one request event. Retried resume delivery while the
mission is already ACTIVE is a no-op, including when an executor holds its lease.
It cannot reset the budget or renew authorization. Authorization remains exact
and single-use. A later execution with a new external effect still needs a new
decision. This is not blanket mission authorization or permission widening.

## Verification

`node --test tests/nova/market-watch-integrity.test.mjs tests/nova/operator-action-guard.test.mjs tests/nova/approval-policy.test.mjs tests/nova/coding-contract.test.mjs tests/nova/agent-loop.test.mjs tests/nova/agent-stuck-condense.test.mjs`

90 tests passed on Node 24.22.1. TypeScript no-emit check and server build passed.
The broad npm test run was incomplete: an automatic security review blocked a
network attempt to skills.example; concurrent dependency installation also
caused one transient missing-express failure. No full-suite pass is claimed.

These regressions cover source boundaries, SQLite-backed approval delivery,
contract budgets and scripted-model continuity. They do not prove model quality,
independently verified autonomy or improvement from memory.

## Remaining acceptance gates

Use the installed selected LLM on fresh tasks with source/provider/model frozen.
Run paired clean workspaces with historical knowledge disabled/enabled, keeping
the same goal, tools, budget and independent evaluator. Counterbalance order and
exclude task leakage. Compare independent task success, false-success claims,
retries, tool calls and actual provider usage/cost. Unknown cost stays unknown.
Do not declare improvement unless paired results support it. A repeated real
mission including restart and failure/replan remains a separate target-host gate.
