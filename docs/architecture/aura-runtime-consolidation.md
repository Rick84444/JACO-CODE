# Aura runtime consolidation

Aura is the product-facing owner of planning, execution and presentation. Existing
SEER planning and Nova executor names identify internal implementation modules;
removing those modules before replacing their state/lease/evidence responsibilities
would remove functionality rather than consolidate it.

First removal: the historical plan autonomousHeartbeat implementation and startup
hook are deleted in every runtime profile. Its separate interval, model reasoning,
market-agent dependencies and command execution no longer enter the runtime through
that scheduler. The four old heartbeat/signoff endpoints return HTTP 410 and point
to the existing Aura start-goal route. Historical plan storage is not deleted or
automatically replayed. Historical manual plan endpoints were left in the original removal; they are
now **read-only**: `GET /api/plans` and `GET /api/plans/:id` preserve access
to old records. All ten direct plan POST mutation/execution endpoints,
including `/step/execute-live`, return HTTP 410 (Gone). They cannot execute a
shell command, forge an execution receipt, modify an old plan or silently
re-enqueue it. The old market-watch `inject-context` write-through is also
retired. For new work use the existing authorized Aura
`POST /api/aura/workbench/start-goal` API (not an automatic migration).

The durable mission dispatcher, SEER planner, Nova worker, coding contracts and
verification receipts remain. This removal does not yet reduce these services to a
single OS process, repair runit ownership, or migrate active missions between hosts.

Next consolidation boundaries:
- Completed: map and retire legacy mutation endpoints. No internal callers were found in the reviewed repository; external callers receive 410 with canonical replacement path.
- Host planning and execution capabilities behind one lifecycle owner, preserving
  durable leases and uncertain-outcome quarantine across restart.
- Keep model servers and device/browser adapters optional and start on demand.
- Migrate legacy vault/plan state explicitly before deleting their storage owners.

Acceptance for this removal: no heartbeat implementation or imports remain; old
activation endpoints cannot execute; current mission lifecycle regressions pass.
Phone footprint and running missions require target-device verification.

Validation: 29 focused runtime/model/supervisor tests passed, TypeScript passed,
and the server bundle built. The bundle reports three import.meta/CommonJS
warnings in other modules; this removal does not resolve that packaging debt.

## Legacy API retirement hardening (2026-10-30)

The previous commit retired the 15-second heartbeat but accidentally left a
separate `/api/plans/:id/step/execute-live` endpoint which executed raw
request-supplied shell commands through `execAsync`, then marked the legacy
plan complete using only output hashes. That was not proof of execution and
bypassed Aura's capability grants and durable receipts.

`runtime/src/server/plan/legacyPlanRoutes.mjs` now exposes historical plan
snapshots and one immutable fail-closed retirement contract for the ten old
write routes. The real HTTP test submits a hostile command payload and asserts
it is refused, no marker file is created, stored snapshots stay unchanged,
and `Cache-Control: no-store` prevents stale success displays. The
market-watch write-through is retired as well; its read-only API stays.

No historical records or secret files are deleted. These changes do not
automatically migrate historical plans or consolidate the Workplace/SEER/Nova
operating-system processes. Live device/Termux verification remains required
before claiming lower memory use, fewer active processes or stable inference.
