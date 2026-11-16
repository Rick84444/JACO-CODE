# ChatGPT ↔ Aura strategic autonomy (contract-bound Git control)

## Status and authority

This feature routes an **operator-authorized structured ChatGPT strategy**
from the existing tokenless Git control ref to the **canonical Aura/SEER
Mission Graph**. It does **not** create a second main agent, a separate
runtime, an independent permission system or a permanent cloud ChatGPT worker.

- **Conversation/presence:** `chatgpt-jaco-relay` uses Workplace. Its Agent Card
  grants communication only; it cannot issue missions or permissions.
- **Strategic goals:** `strategy.graph.create` in the established
  `jaco-control:.jaco/nova-control.json` branch is processed by Nova's
  Git inbox, but creates the graph in Aura's existing authenticated loopback
  SEER service. The graph's existing governor controls dispatch.
- **Execution:** Existing SEER graph dispatch produces canonical Nova missions;
  the existing local tool, permission, coding contract and spend rules still
  apply. Graph nodes appear as task-agent contexts under Aura, not new root
  agents. Each must be verified before dependent work unblocks.
- **Receipts:** `jaco-control-status:.jaco/nova-status.json` includes
  `operation=strategy.graph.create` and the actual `graphId` / graph state.
  This is a bounded **index**, never an execution proof or financial approval.

The GitHub repository and control branch are **public**. Use only nonsecret
instructions. GitHub repository write access is not equivalent to a privately
authenticated interactive ChatGPT session. No private Workplace events, tokens
or host details belong in control JSON or public receipts.

## Local operator activation

This channel is fail-closed by default. Only an authorized local operator can
enable it in the Windows service environment. A user message, Git commit or
model-generated document does not turn it on.

```text
JACO_CHATGPT_STRATEGY_ENABLED=1
JACO_CHATGPT_STRATEGY_ALLOWED_TASKS=health-check,detect-surfaces
JACO_CHATGPT_STRATEGY_MAX_NODES=8
JACO_CHATGPT_STRATEGY_MAX_STEPS=20
JACO_CHATGPT_STRATEGY_MAX_TOOL_CALLS=60
JACO_CHATGPT_STRATEGY_MAX_DURATION_MS=3600000
```

These maximum values are *strategy admission bounds and metadata*, **not**
a newly implemented per-mission step counter. Hard spending and execution
controls remain with the canonical Aura/Nova runtime. Do not claim a budget
is enforced unless the corresponding runtime evidence demonstrates it.

For code work, the operator may explicitly add permitted coding task types
to `JACO_CHATGPT_STRATEGY_ALLOWED_TASKS` and exact permitted contract paths
to `JACO_CHATGPT_STRATEGY_CODE_ROOTS`. Every node must then include a valid
scoped coding contract. Remote Git commands cannot widen allowed paths,
change operator preapprovals, authorize Git push/merge, run arbitrary test
commands, configure new services, or supply spending authority. Approved test
commands must additionally be enumerated locally in
`JACO_CHATGPT_STRATEGY_TEST_COMMANDS`.

No default shell, browser write, deployment, checkout, payment, account
creation or secret access is granted. Existing operator approval gates stay on.

## Strategy command format

Push the following harmless example to the existing `jaco-control` branch
as `.jaco/nova-control.json`. Use a new unique `commandId` for each graph.

```json
{
  "schema": "jaco.nova-control/v1",
  "commandId": "chatgpt-aura-strategy-20261116-test1",
  "op": "strategy.graph.create",
  "graph": {
    "title": "Verify JACO's strategic execution pipeline",
    "objective": "Produce verified local-runtime evidence and summarize results",
    "nodes": [
      {
        "key": "health",
        "title": "Observe runtime health",
        "objective": "Verify the local runtime without mutation",
        "dependencies": []
      },
      {
        "key": "report",
        "title": "Document the evidence",
        "objective": "Inspect the health evidence and report verified conclusions",
        "dependencies": ["health"]
      }
    ]
  }
}
```

The server validates a bounded acyclic graph (1–12 nodes), ensures only
operator-configured tasks are used, generates a deterministic graph ID for
idempotence, and calls `POST /cortex/mission-graphs` via loopback and the
existing JACO gateway token. The code does not need a GitHub API token.

## Verification matrix

1. **Admission denial** (local flag absent): Git status = `REJECTED`,
   no SEER graph created.
2. **Authorized admission**: status ref supplies a nonempty real `graphId`;
   GET that ID on the local SEER service.
3. **Dependency integrity**: the dependent node stays BLOCKED until its
   prerequisite produces a verified evidence reference.
4. **Safety**: a public command cannot add shell, deployment, spending,
   arbitrary code paths or approvals; reject rather than silently relax.
5. **Runtime persistence**: the local Aura/SEER graph and Nova mission receipts
   survive a controlled restart; unchanged command IDs do not create duplicates.
6. **Failure handling**: unavailable SEER/Workplace or a missing Git identity
   produces a truthful blocker; do not display `DONE` on an admission receipt.

## Existing Windows blocker

A reported `PROJECT_NOT_GIT_ROOT` means a separate project's coding mission
has selected a path that is not **exactly** a Git repository root. This is a
safety guard, not an error to suppress by changing to an arbitrary parent.
Inspect the mission's stored `projectRoot` and the local
`git rev-parse --show-toplevel` on that exact host. Create a correctly
scoped replacement mission only after verifying the intended root. Do not
restart a stalled mission repeatedly or replace the current checkout.
Strategic control does **not** accept a Git-supplied project root.
