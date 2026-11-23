# Meta-reasoning after a mission

Aura does not only ask how to solve a problem. When a mission went wrong she also asks why she believed her
approach was right, and what to change in how she decides.

```text
expected -> actual -> gap -> cause -> improved decision method
```

Owner: `agents/lib/meta-reasoning.mjs`, run from the existing learning tick in `runtime/server.ts` next to
`agents/lib/skill-learning.mjs`. It is a capability of the one agent, not a separate agent or planner.

## Cost levels

| Level | When | What runs |
| --- | --- | --- |
| 0 | every tool call | nothing extra |
| scan | every blocked or finished mission, once per stage | plain code over receipts and bus events (`decisionFindings`) |
| reflection | only when an objective signal fired | a stored reflection, plus one model call if the mission took at least one action |

Signals (`metaTrigger`): the mission blocked, two or more failed actions, an unknown outcome, done without
machine verification, or cancelled with an observed mistake. A model's own impression of being stuck is not a signal.

## Mistakes the scan recognises

`REPEATED_UNCHANGED_ACTION`, `ASSUMED_RESOURCE_EXISTS`, `GOAL_OUTSIDE_AUTHORITY`, `ACTED_WITHOUT_VERIFICATION`,
`EXPECTATION_GAP` (planner lessons) and `SAME_BLOCKER_AFTER_RESUME` (a lesson for the operator, never shown to the
planner). Each has a fixed rule in `PATTERNS`; the rule text is not written by a model.

## What may be stored

A lesson needs evidence: receipt action ids or bus events (`bus:<seq>`) from its source mission. The model is asked
for the mistaken premise behind the plan; its answer is kept only if every reference it cites exists in the mission
and at least one shows a failure or a block, and its rule is advice rather than an instruction about authority,
secrets or spending. Every model that was asked is recorded with its result, including provider refusals.

The fixed rules in `PATTERNS` are source code and go on trial by themselves. A rule written by a model is derived
from mission content, so it is stored as `PROPOSED` and is not shown to the planner until the operator approves it.

Lessons reach the planner through the mission preflight context (`decisionLessons`) and are labelled as advice
that grants no permission and never overrides the mission contract.

## Measuring

- A lesson starts as `TRIAL`. While on trial it is withheld from about one mission in four, which keeps a
  comparison group.
- Each mission it was shown to is scored `AVOIDED` or `RECURRED` for the mistake the lesson is measured by.
- After three scored missions: retired when the mistake recurs in half of them or as often as without the lesson;
  `ACTIVE` when it recurs in at most a third and clearly less often than in the comparison group.
- `AVOIDED` is a proxy: a mission may not have had the occasion to make the mistake.

## Inspecting and overriding

- `GET /api/aura/workbench/meta-lessons`: lessons with their measured effect, and the latest reflections.
- `POST /api/aura/workbench/meta-lessons/:id/approve`: the operator puts a model-written lesson on trial.
- `POST /api/aura/workbench/meta-lessons/:id/retire`: the operator retires a lesson.
- State: `runtime/.jaco/meta-lessons.json` and `runtime/.jaco/meta-reflections/` (local, not in Git).

Tests: `tests/nova/meta-reasoning.test.mjs`. The fixture is the mission of 2026-11-12 that spent ten steps inside
`artifacts/aura/` before reporting that its goal lay outside the mission's scope.
