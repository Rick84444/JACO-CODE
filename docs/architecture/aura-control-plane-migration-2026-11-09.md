# Aura Cognitive Runtime — single control-plane migration (2026-11-09)

## Canonical architecture

**Aura alone accepts the operator's goals and owns their execution policy.** The old
SEER and Nova process names are compatibility adapters; they are not independent
agents and may not escalate permissions. This migration deliberately preserves
all existing on-disk strategy SQLite, mission ledger, worker leases, receipts,
operator decisions and stored identifiers until equivalent in-process services
pass restart/recovery tests.

## Implemented in PR #209

1. The older gateway's **two independent scheduling timers** have been replaced
   by `createAuraControlLoop`, which serializes reconciliation and planning.
   It first reads durable executor outcomes, then invokes one bounded planning
   turn. A reconciliation failure prevents dispatching from stale state.
2. Aura Core now runs `createAuraCoreController`. On HTTP startup it attempts
   to claim the sole orchestration lease from the strategy state service.
   When claimed, the strategy service suppresses its fallback control timer.
3. The lease is short-lived and **fenced** by a token not exposed in health
   status, logs or Gameboard. Core can renew it on a tick; a second claimant and
   stale tokens are rejected. When Core disappears, the lease expires and the
   strategy service safely resumes scheduling against the same durable ledger.
4. Operator-facing, read-only diagnostics:
   `GET /api/aura/runtime/control` (Core, requires existing local UI auth) and
   `GET /health` `aura_control` (loopback strategy adapter). The former reports
   Core status without credentials; the latter reports owner/fallback and
   execution schedule without credentials.
5. Legacy fallback selection: set `JACO_AURA_CONTROL_OWNER=legacy` in the
   canonical runtime environment and restart Core. The Core scheduler then
   does not attempt a lease. **Do not** change that setting mid-mission or
   restart services during an ongoing non-idempotent action.

## Authority and data boundaries

- The canonical durable `NovaMissionControl` and `DurableMissionBus` remain
  the only execution ledger. Existing authorization for tool mutation, operator
  stop/steer, leases and evidence receipts is unchanged.
- The legacy strategy SQLite stays the authoritative strategy/graph storage.
  Core only claims **scheduling ownership**; it does not invent another planner
  database, alter previous mission IDs, or replay unknown external writes.
- A successful Core lease is proof of control-plane ownership, **not** a proof
  that the selected LLM answered or that an entire user goal completed.
- `runtimeConsolidated:false` stays true in health/API: **this is not a
  one-operating-system-process deployment**. The strategy-state adapter and
  durable execution worker still run separately while their storage migration
  remains incomplete.

## Verified by source tests / CI acceptance

- Durable reconciliation always precedes new graph dispatch.
- No overlapping control ticks; no double active lease.
- Failed reconciliation blocks planning, and the next tick can retry.
- Core shutdown during a delayed lease claim does not schedule new work.
- Expired, revoked or incorrect leases cannot advance graph work.
- Read-only planning configuration continues to reconcile execution outcomes.
- Full HTTP strategy route verifies authenticated ownership, tick, health
  redaction, release and fallback.

## Remaining engineering work before removing compatibility services

1. Extract strategy graph/decision storage from the older HTTP service into an
   Aura-owned in-process module, with an **atomic SQLite migration** preserving
   the original `seer.db` and all IDs/events. Verify two owners can never
   simultaneously write the graph, even on Windows power loss/restart.
2. Run the existing durable execution worker as a managed Aura capability
   without losing leases, action receipts, pending approvals, tool sandbox
   boundaries or model-provider choice. Reconcile all in-flight work before
   switching the executor.
3. Fault-inject crashes during plan, dispatch, tool execution, and final
   verification. Prove restart, one-time side effects, rollback and operator
   stop precedence using actual persisted fixtures.
4. Verify Core-only operation with multiple chat turns, Git/file edits,
   MCP/CDP calls, stop/resume, live Gameboard and local memory, on a real
   Windows installation. Update the Windows installer and installed service
   layout only after these gates pass.
5. **Only then** retire old auto-start services and public compatibility routes.
   Removing source names early would lose operating state and make autonomy
   worse, not better.

## Status

- [REAL] Core-owned control orchestration implementation exists.
- [REAL] Existing adapter databases and mission leases are reused.
- [UNKNOWN] Physical Windows restart/failover and live mission outcomes.
- [RISK] Retiring legacy OS processes before storage and lease migration.
- [SPEC] Final one-process Aura runtime with no SEER/Nova independent services.
