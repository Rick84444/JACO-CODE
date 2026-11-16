# Design — canonical strategy authority and missing-graph recovery

## Ownership

ChatGPT external client -> operator-controlled public Git ref (`jaco-control`) ->
existing Nova Git inbox -> local operator strategy policy ->
authenticated loopback SEER `/cortex/mission-graphs` -> existing Aura strategic
Gameboard -> canonical Nova Mission Bus and guarded execution.

`chatgpt-jaco-relay` remains a **communication-only** Workplace identity.
The Git strategy command is a separate operator-approved control ingress, not
a permission inherited from the ChatGPT Agent Card.

## Admission decisions

1. `JACO_CHATGPT_STRATEGY_ENABLED=1` must be set locally, not in the public ref.
2. The operator selects allowable task types, approved code paths and test commands
   through its own configuration; no Git payload may add spending authority,
   secrets, model switches, shell, approvals, deployments or arbitrary tests.
3. The command carries a bounded acyclic dependency graph. Its ID is deterministic
   from the repository and command ID. Source/graph state lives only in SEER.
4. Per-node coding contracts are normalized against the local operator allowlist.
   Dynamic workspace tests and unapproved test commands remain denied.
   Budgets must be integer and cannot exceed local configured maxima.
5. Git status contains a compact graph ID and state only, not private content.
6. A graph is not successfully completed until the authoritative SEER graph's
   nodes have evidence-backed VERIFIED states. Receipt publication is not proof.

## Failure handling

Git inbox `refreshTracked` may receive `null` after SEER returns 404 for a
previously accepted graph. It SHALL mark this tracked entry `UNVERIFIED`,
phase `GRAPH_MISSING`, error `CHATGPT_STRATEGY_GRAPH_NOT_FOUND`, closed=true.
This closes the *receipt tracking entry*, **not** the graph as successful.
Other entries continue to refresh and new Git commands continue to be admitted.
Transient connection errors remain transient; do not confuse timeout with 404.

This failure handling is narrow; the existing safety guard
`PROJECT_NOT_GIT_ROOT` for incorrectly rooted coding worktrees must remain in place.
A missing graph does not justify restarting other missions or moving project roots.

## Test and verification

- Unit negative test: missing graph then new mission creation in the same poll.
- Existing regression tests: rejection without local opt-in, DAG cycle denial,
  code path and budget restrictions, dynamic test bypass refusal and idempotence.
- CI: Autonomous Delivery, Autonomous Coding Contract and Technical Debt gates.
- Live acceptance remains separate: on the actual Windows host install this
  version, verify the ChatGPT transport and operator contract, then observe
  Graph ID, Gameboard dependencies, Nova receipts, and a restart/reconnect.

## Risks

A public Git repository is unsuitable for confidential user goals. Operator
configuration alone does not make a public branch a private authenticated
conversation. Sensitive strategic deliberation belongs in a verified private
MCP/Workplace link.
