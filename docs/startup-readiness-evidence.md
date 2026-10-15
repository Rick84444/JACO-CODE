# Startup readiness evidence

The canonical launcher remains agents/start-all.ps1 -> agents/lib/local-stack.mjs. No parallel supervisor is introduced.

Once the launcher owns the startup lock, status.json is atomically replaced with STARTING before service probes. Each service phase updates the receipt with runId, monotonic sequence and observedAt. Completion adds completedAt; failure retains the failed phase and error. An interrupted run can leave STARTING, which is not proof of readiness. Compare observedAt and runId rather than treating an old receipt as current.

--status performs fresh semantic probes without launching or stopping processes. It also checks Nova's Workplace supervision and live session, using the same predicates as startup. Output excludes probe response bodies and credentials. Aggregate state is READY only if every required check passes; BLOCKED exits with code 1. Service readiness does not establish useful task execution or public tunnel reachability.

Executed 2026-10-10:

- 18 startup observation, safety and remote-startup tests passed, including a real HTTP probe changing from healthy to unhealthy, stale READY replacement observed during startup, foreign listener preservation, process birth checks and duplicate-start lock protection.
- Fresh local inspection detected Nova Bridge HTTP 500 and gateway HTTP 503 while other services and Nova's session remained ready.
- CDP port 9222 was unavailable. The canonical launcher restored Chrome connectivity and completed with READY, browserAttachment ATTACHED and sequence 21. Existing service owners were reused.
- Physical reboot, forced runtime interruption mid-mission, sustained operation and target laptop startup remain separate acceptance checks.
