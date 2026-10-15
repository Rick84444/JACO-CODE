# Helix modernization baseline

Source of truth: `master` at `81fe9212f85c1b6bfa737c50aa61f004728b0975` (2026-09-17). This is a focused control-plane map, not a claim that every file or deployment path has been verified.

| Concern | Existing canonical owner | Observed contract |
| --- | --- | --- |
| Shared coordination | `gateway/src/workplace/` | Agent registration, sync, ACK, claims, status and handoff. |
| SEER planning and falsification | `gateway/src/seer-strategy.mjs` | Strategy ranking, surprise, falsifiers and replanning. |
| Durable Nova execution | `src/server/connected/novaMissionControl.mjs` | Mission lease, receipt and expired-lease recovery. |
| Continuum execution | `src/server/continuum/` | Mission ledger, commitments, scheduler, evidence, hypothesis and knowledge stores. |
| Model routing and spend | `src/server/continuum/modelRouter.mjs`, `economicGovernor.mjs` | Provider routing with economic authorization; cloud defaults denied. |
| Signed surface authority | `src/server/relay/modelRelay.ts`, `src/server/autonomy/` | Signed mandates, single-writer actuator lease and verified action receipts. |
| Desktop execution | `agents/desktop-agentos.mjs` | SEER → Nova → ModelRelay → desktop receipt. |

## Prioritized gaps

1. **Knowledge truth lifecycle (addressed in this PR).** `KnowledgeStore.put` accepted arbitrary evidence IDs, had no verification state, and search returned stale knowledge by confidence alone. The canonical store now checks references, requires verified evidence for `VERIFIED`, demotes edited content to `UNVERIFIED`, and excludes explicitly inactive conclusions from normal search. Status transitions are exposed in both Continuum HTTP surfaces.
2. **Outcome-to-knowledge linkage (next).** Hypothesis evaluations and SEER falsifiers exist, but their outcomes are not yet shown to update canonical knowledge automatically with contradiction or supersession links. Define a single evidence-backed bridge to `KnowledgeStore` rather than another memory engine.
3. **Cross-control-plane recovery proof (next).** Nova, Continuum and Desktop AgentOS each have recovery mechanisms; a combined kill/restart/unknown-outcome test is needed before claiming end-to-end durable execution.
4. **Provider recovery proof (next).** Provider-neutral failover has a focused test; run a fault-injection matrix for timeouts, reservation release, half-completed responses and restart before broader reliability claims.

Preserved invariants: operator authority, single-writer execution, signed financial mandates, paid-model opt-in, Durable Nova, Workplace, ModelRelay, Desktop AgentOS and verified receipts are not replaced or bypassed by this change.

## Verification scope

- `npm run test:continuum-runtime` — unit behavior plus standalone HTTP knowledge lifecycle.
- `npm run test:ledger` — ledger integrity.
- `npm run test:reflective-futures` — provider neutrality and existing evidence/review contracts.
- Full gateway/sidecar integration requires installing gateway dependencies in a fresh clone; no end-to-end runtime claim is made from these tests alone.
