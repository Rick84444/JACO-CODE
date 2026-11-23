# Mission triage: Aura chooses what keeps running

## Problem

The Nova queue is first-in first-out. Resumed old missions and four retries of the same drill queued ahead of the goal the operator
had just started, and the executor answered `MISSION_NOT_CURRENT` for minutes (2026-11-23). The operator wants Aura to choose the
important one, pause the others, and end what is no longer relevant, and not to restart a similar job without a reason.

## Scope

- `runtime/src/server/connected/missionTriage.mjs` (pure rules) and two methods on the existing `NovaMissionControl` (`triage`,
  `findSimilar`). No second queue, planner or approval system.
- `POST /api/aura/workbench/missions/triage` (dry run unless `apply`), an opt-in timer (`JACO_MISSION_TRIAGE=1`), and a guard in
  `start-goal` that reuses a running identical goal and reports a similar task finished in the last day (`similarDone`).

## Acceptance and falsifier

Acceptance: a retry of the same task family without verified progress is cancelled; an older mission idle for 15 minutes behind a
newer goal is paused; a mission with a pending operator decision or spend approval, a paid order, a graph child, a running step, a
paused or ending mission is never touched. Falsifier: any test where one of those is decided on.

## Non-goals

Judging that a goal is "mostly done" (that stays with verification), cancelling anything that made verified progress, resuming
what was paused (the operator resumes), and changing the queue order.
