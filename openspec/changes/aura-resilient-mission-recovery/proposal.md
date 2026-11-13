# Aura resilient mission recovery

## Why
Known recoverable stalls are being promoted to permanent operator blockers even though the selected provider, structured planner, durable Mission Bus and bounded graph repair already exist. The operator must not have to restart or manually replan a mission merely because its native tool protocol stalled.

## What Changes
- Switch bounded native tool stalls to the existing structured planner on the same selected provider and durable mission.
- Let a graph mission request bounded automatic repair with empty subgoals, preserving its original contract and acceptance.
- Defer temporary provider and preflight transport outages while keeping receipts and queue state.
- Preserve fail-closed authorization, operator stop, uncertain side effects and lease acknowledgement.
- Add negative tests and a format-validation test for the OpenSpec delta.

## Impact
Affected subsystems: agent loop, health classification, hands-off runtime, durable Nova mission control, existing SEER graph repair and regression suites.
No additional runtime, permission or financial authorization is introduced.
Baseline: `main` 118f2970a6f4912cfa71f9818368470318f3905f.
Live Workplace synchronization was unavailable to this GitHub-only session: DEGRADED_UNSYNCED. Installed Windows runtime remains unobserved.
