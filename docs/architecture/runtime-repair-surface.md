# Runtime status and repair surface

The activation warning can be dismissed into a compact right-aligned status
button and reopened without changing the underlying health report. Dismissal is
local to the mounted view and does not declare a fault resolved.

The repair action submits diagnostic problems to the existing start-goal flow.
It requires an acknowledged goal ID, disables repeated submission within the
card, and is unavailable while the observed mission list contains active work.
An uncertain submission is displayed explicitly and is not automatically retried.
This is an operator-triggered agent repair attempt, not an automatic startup loop
or a guarantee that a broken planner can repair itself. Runtime policy and tool
permissions remain authoritative.

Validation: TypeScript and 17 existing GUI regression tests passed. Physical
Android interaction and successful autonomous repair are not verified here.
