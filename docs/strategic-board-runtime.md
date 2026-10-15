# Operational Shack strategic board

The strategic-board calculation recovered from `feat/aura-cognitive-contract-hardening`
now participates in SEER decisions and actual mission dispatch. It is not a separate executor.

## Shared reasoning

| Participant | Runtime connection | Obligation |
|---|---|---|
| SEER governor | Candidate board forecasts enter strategic ranking | Compare consequences of alternatives; reject impossible plans |
| SEER dispatcher | `missionGraph.ready()` ranks executable moves | Prefer blocker removal, critical path, goal impact and verification |
| Nova and device executors | Durable mission parent carries board and selected move; brain refreshes graph context | Execute within assigned contract and return receipts |
| Repair planner | Failed-node prompt includes current board and evidence | Preserve authority, budget and acceptance; repair the implicated branch |
| Invoked workers | Worker request carries objective, selected move, board, allowed tasks and contract | Advise within the same assignment |
| External/model agents | Agent ping advertises shared endpoint; active memory and authenticated agent context include board instructions | Read current board before mission planning; report stale context |

`GET /cortex/strategic-board` exposes active graphs with shared instructions.
`GET /cortex/mission-graphs/:id/board` returns current status and board. Both require
the existing SEER bearer token. Each projection is rebuilt from SQLite execution
states; no second copy of execution truth is authoritative. Receiving context does
not prove that a running external agent has read or understood it.

## Decision and evidence rules

Candidate ranking combines 60% board consequence score and 40% existing opportunity
score. The no-work baseline retains its existing score. Invalid or wholly blocked
plans score -1. Candidate forecasts are estimates; they never satisfy verification.
Step ordering reuses the original board weights: goal impact, blocker removal,
critical path, verification/information gain, confidence, reversibility, parallelism,
risk and effort. Structural goal/verification defaults support existing graphs.

Hard obstacles create effective prerequisites, including step-declared obstacles.
Their resolvers must be VERIFIED with evidence before blocked work can dispatch.
Graph cancellation/exhaustion stops dispatch. RUNNING and DISPATCHED work is excluded
from move selection. Failed resolver replacement rewires both ordinary dependencies
and obstacle references while retaining strategic metrics. An additive SQLite column
stores node metrics; obstacle metadata is stored in the existing graph policy.

Forecasts assume independent confidence factors, count shared ancestors once and
replace verified estimates with facts. Missing resolvers and failed dependencies
make descendants unreachable. Outputs explicitly label forecasts as assumptions.
Automatic completion still uses existing Nova receipt and contract verification;
the board cannot grant authority or skip gates.

## Real verification

Run `npm run test:strategic-board`. It is also included in `npm test`.

The runtime test starts production SEER and mounts the actual Nova HTTP routes
against its durable SQLite mission bus. A real source file initially fails an actual
Node test. Shack orders repair before optional polish, Nova's coding workspace writes
the fix and runs the contracted test, and SEER confirms machine-verified completion
without a new approval. Verified receipts clear the obstacle, dispatch downstream
acceptance, and finish the graph as VERIFIED. The final source hash is printed.
The production verifier removes `NODE_TEST_CONTEXT` from child environments so
nested Node tests actually execute; the initial failing source is also checked through
that verifier to guard against false green results.

This verifies local algorithmic reasoning, dispatch and execution. It does not verify
live provider inference, Windows/Android installation or deployment to an operator
device. The isolated test explicitly disables Workplace registration; it does not
claim synchronization with the operator's live Workplace or other running agents.
