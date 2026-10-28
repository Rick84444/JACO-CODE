# JACO Continuum / Cognitive Lab Execution Leash

Status: REAL Node runtime integration of the **deterministic** Cognitive Lab, **not** a language-model-driven autonomous code author. No automatic GitHub push or merge. The lab writes only under `WORKSPACE_ROOT/.jaco/autonomous-cycles` and its own nested Git repository.

## Owner and execution authority

- The canonical `ContinuumRuntime` is the **single owner** of `ExecutionLeaseManager` and the new `AutonomousCycleLeaseBridge`. No second lease database and no separate scheduler.
- `CYCLE_AGENT_ID=jaco-cognitive-lab-executor`, `CYCLE_MISSION_ID=jaco-cognitive-lab`, `CYCLE_ACTION=COGNITIVE_LAB_RUN`. No user-selected command, source directory, cloud provider, task list or shell arguments.
- `POST /api/continuum/autonomous-cycles/lease` issues a bounded zero-cloud, **one action** lease. Default 15 minutes; the IDE requests 5 minutes.
- `POST /api/continuum/autonomous-cycles/run` takes `{ "leaseId":"...", "operationId":"unique-01", "until":3 }` (1–33). It returns HTTP 202 and progresses asynchronously. Each cycle is an independently spawned child process with a bounded time and output limit. Review attestation and event-chain verification are checked before progressing.
- `GET /api/continuum/autonomous-cycles/status` shows the Continuum lease status alongside the existing IDE journal projection. `POST /api/continuum/autonomous-cycles/stop` with the active `leaseId` revokes and fences the run.
- Every start performs **beginAction** before execution. A successful final receipt uses `finishAction` and a local journal SHA-256. A failed, interrupted or crashed action stays `UNKNOWN_OUTCOME` and cannot be replayed automatically. A human must independently reconcile unknown operations before any future run; the current bridge intentionally lacks a reset/unblock action.
- Operator pause, emergency stop and runtime close request cancellation and revoke leases; single writer remains canonical. A crash can leave an in-flight child performing at most one bounded cycle. The old lease is quarantined upon restart.

## Operator walkthrough

1. Start your usual JACO server and open the **Autonom utveckling** tab.
2. Check Continuum status and click **Ge 5 min lease**.
3. Click **Kör nästa 3 cykler**. The IDE polls for progress; the user's `main` branch is **not touched**.
4. Optionally click **Stoppa**. A stopped run may show `RECONCILIATION_REQUIRED`; the system **does not** auto-resume it.

POST requires the existing JACO operator authorization middleware; the Continuum router also uses its existing `requireAuth`. A local same-origin operator or valid gateway-authenticated IDE session is required by the existing server configuration.

## Truth and limitations

- **[REAL]** Continuum-issued one-action lease, beginAction/finishAction/markUnknown, subprocess launch, stop, HMAC-tested local reviewer receipts, persistent event chain, IDE progress.
- **[SIMULATED]** User/Developer/Debugger/Reviewer/Senior/Technical Debt roles choose predefined candidates; real code is executed in a child process, but the agents do not independently reason with LLMs.
- **[RISK]** All actors share the machine's OS identity. The local HMAC does not isolate hostile code with OS-level privileges. Child processes are bounded but **not kernel-sandboxed**. A hard kill can leave partial artifacts requiring manual recovery.
- **[UNKNOWN]** No Termux-on-device test or end-user UX rating yet. This is not an authorization to execute arbitrary JACO work on an unattended device.

## Tests

`node --test tests/cognitive-lab/*.test.mjs tests/nova/cognitive-capsule.test.mjs`

The lease bridge's tests cover invalid scope, one-shot budgets, real execution and receipt, replay denial, stop/fencing/restart-unknown, and operator pause.
