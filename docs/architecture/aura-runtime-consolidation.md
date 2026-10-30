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
automatically replayed. Historical manual plan endpoints still exist and require a
separate migration; this change does not claim that all legacy execution is gone.

The durable mission dispatcher, SEER planner, Nova worker, coding contracts and
verification receipts remain. This removal does not yet reduce these services to a
single OS process, repair runit ownership, or migrate active missions between hosts.

Next consolidation boundaries:
- Retire remaining manual legacy plan mutation after mapping its clients.
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
