# Compact planner context

Nova uses `NOVA_CONTEXT_PROFILE=compact` by default. `standard` selects the previous
context projection for comparison. Model selection, authorization, payment limits,
completion checks, retry limits and decoding budgets are unchanged.

The compact projection lives with the existing context-packet code. It removes the
duplicate preflight tool contracts (the planner already has task fields/native
schemas), summarizes older successful verified read-only receipts, and presents a
30-entry root inventory with relevant open-file directories first. Omitted entry
counts and instructions to list a concrete directory are explicit.

The full existing projections of goal, mission contract, permissions, current file
content/hashes, skill instructions, verification state, failures, uncertain results,
mutations and the latest three receipts remain. This is not a hard token cap: a
large contract or file can still require a larger model context window.

Native MCP tools retain every schema, tool name, permission classification and
learned caution. The eight tools most relevant to the goal/recent tool names retain
their prose descriptions; other tools lose descriptive prose only. No capability
is removed and no new tool registry or routing authority is introduced.

A reread of an older file now moves that file to the newest observed-content slot.
Successful writes/edits still invalidate the cached read, through the existing owner.
No tool execution is skipped just because a prior receipt exists.

## Measurements

`callBrain` records at most 20 entries in `state.plannerMetrics`: context profile,
original/projected context character counts, system characters, native tool schema
characters/count where applicable, elapsed planning milliseconds and whether a
proposal was returned. No prompts, paths, goal text or model answers are copied into
these metrics. Planning time includes context acquisition and proposal retries;
character counts are not token counts and a returned proposal is not task completion.

The existing isolated local-model check prints `PLANNER_METRIC` after every turn,
including rejected proposals. With a running loopback llama.cpp server:

```sh
NOVA_CONTEXT_PROFILE=standard node scripts/verify-local-agent.mjs
NOVA_CONTEXT_PROFILE=compact node scripts/verify-local-agent.mjs
```

Compare repeated runs using the same model, context window, threads and cache state.
Check elapsed time, number of turns/repeated reads, and final verified completion.
The test never permits a paid provider or edits an operator project. A model that
fails completion remains a failed benchmark, even if its prompt became smaller.

On 2026-10-24 a controlled large-preflight/read-history fixture shrank from 50,700 to
6,756 characters (87%). This fixture intentionally contains repeated schemas; the
percentage is not a representative speedup or a universal reduction. No local model
was listening on port 9380 in the execution environment, so actual inference latency,
phone speed and small-model end-to-end completion remain unmeasured.

## Strategic board and conversational execution

Both planner paths now focus MCP descriptions using the same helper. The
conversational loop replaces its retained mission packet before subsequent turns,
using the latest finished mission receipts and a fresh read of the canonical SEER
board. It does not append duplicate board messages. Home and skill extras remain
cached for the run. The existing condenser retains that mission packet.

Dispatch board snapshots must match the parent graph; selected snapshot moves must
match the assigned node. A live board with no assigned move no longer resurrects
an old dispatch move. Worker prompts preserve those explicit null results instead
of silently falling back to mismatched snapshots. Board context grants no execution
authority; existing mission gates still validate every action.

Regression tests cover refreshed receipt state without duplicate packets, crossed
snapshot identities, and removed live moves, including worker prompt propagation.

Verification on 2026-10-25, rebased onto main `adf0cad`: `npm test`
passed 792 tests, skipped 5, failed 0. `npm run lint` passed JavaScript
syntax checks (not a runtime build). The focused board/agent-loop suite passed
23 tests. No physical-device or real-model inference result is claimed.
