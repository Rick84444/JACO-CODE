# Harden ChatGPT strategy ingress and recover missing Gameboard graphs

## Why

The merged strategy ingress gives ChatGPT a tokenless Git route to Aura's canonical SEER
Gameboard, but a post-merge review of PR #257 identified two release-quality gaps:
the non-trivial change lacked its OpenSpec artifact, and a tracked graph that returns
404 can halt the Git inbox before it receives later operator commands.

This change records the admission and safety contract for the already-merged feature
(retrospectively; it does not claim to predate PR #257), then repairs the missing-graph
recovery path.

## Changes

- Specify exactly when Git strategy graphs are admitted into Aura's existing Mission
  Graph and what operator authorization remains local.
- Treat a missing authoritative graph as UNVERIFIED / GRAPH_MISSING, not DONE.
- Publish bounded failure evidence without disclosing goals, host paths or secrets.
- Continue refreshing and accepting other Git commands even when one graph vanished.
- Add deterministic regression tests for the lost-graph case.
- Preserve idempotent graph identity, SEER graph verification, local budgets,
  code path restrictions and existing revenue/deployment approvals.

## Impact / safety

Affected: existing Git inbox, bounded receipt projection, Nova regressions and docs.
No new runtime, remote port, automatic token, operator permission or financial grant.
The local Windows install is not updated by merging this PR.

## Falsifier

Create a graph through the Git inbox, then have the canonical graph reader return
null for its ID. A subsequent *ordinary* mission.create command MUST still be
accepted once; the former graph MUST be recorded as UNVERIFIED and never as DONE.
