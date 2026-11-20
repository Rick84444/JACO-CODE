# Design

The persisted SEER mission graph is Auras authoritative strategy; Nova remains the existing execution adapter. The UI remains read-only and reflects the real graph. After new observations, the model may request an in-place strategy revision (subgoals []), or 2–8 sequential subgoals. The existing release boundary validates the shape, graph identity, lease and operator steering revision; one subgoal is rejected. Existing unknown-outcome quarantine and remaining-budget allocation remain authoritative.

The repair planner compares feasible alternatives using evidence, obstacles and forecasts, preserving the original objective and contract. The comparison is model reasoning, not an independently measured probability or proof. The existing replan record stores the selected reason and evidence references.

Every awaited dispatch is followed by a fresh ready() ranking before the next attempt. A per-graph attempted set prevents repeating one key within a turn, and the existing per-turn limit counts failed attempts. Actual eligibility is checked by the canonical dispatch boundary. The selected strategic move is included in the existing dispatch event, not counted as completion.

## Limitations
No live editing of an executing action, arbitrary dependency rewrites or unbounded optimization. Full provider and installed-host verification is a separate gate.
