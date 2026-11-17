# Preserve mission progress on duplicate actions

A repeated verified mutation currently proposes mission completion without evidence that the goal is complete. Return bounded planner feedback instead, using the existing release/failure mechanism.

Acceptance: duplicate actions are not executed and do not propose completion; a different next action can continue. Repeated unchanged proposals still hit the existing failure limit.
