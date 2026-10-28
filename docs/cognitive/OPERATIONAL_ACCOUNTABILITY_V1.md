# Operational accountability v1 — Continuum

The canonical runtime now projects historical quality penalties from its existing hash-chained event ledger. It does not create a competing state store or a new lease mechanism. The projection is available as `ContinuumRuntime.status().operationalAccountability`.

An observed startup, calculation, integration or lease execution incident contributes one penalty. Two events about the same execution operation count once. Historical penalties do not reset on process restart; the projection reads the complete loaded event ledger. If evidence is incomplete or its hash-chain fails, the penalty count is `null` and the readiness indicator becomes `BLOCKED`, never zero/green.

An unresolved `UNKNOWN_OUTCOME` lease operation and an operator pause/emergency stop also produce `BLOCKED`. Without blockers, the projection is only `NOT_VERIFIED`: a fresh supervised-process and HTTP/identity startup probe (e.g. via `runtime/bin/jacoctl`) is required to establish whole-system READY. Simulation results and absent events are never proof of successful real execution.

**Instrumented events:** `cycle.bridge_unknown`, `lease.action_unknown`, `lease.recovered_unknown_outcomes`. **Reserved event types needing additional production instrumentation:** `runtime.startup_failed`, `runtime.startup_invalid`, `runtime.calculation_invalid`, `runtime.integration_failed`. Uninstrumented errors and boot failures before the ledger starts are not covered. This v1 is a read-only diagnostic, not a new automatic execution gate, UI success score or independent cryptographic audit.

Run: `node --test tests/cognitive-lab/operational-accountability.test.mjs`. Separate GitHub CI and real Termux deployment testing remain required.
