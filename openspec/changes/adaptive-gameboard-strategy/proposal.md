# Adaptive Gameboard strategy

## Why
The canonical board already ranks executable moves and the mission graph supports selective repair. A dispatch turn nevertheless consumes a snapshot of ready moves across awaited dispatches, and the model-facing replan schema forces decomposition even when changing approach is sufficient.

## What changes
- Read the current canonical ranking before every dispatch attempt, with a bounded attempted-key set.
- Expose the existing zero-subgoal repair path to native and structured planners and direct Aura to compare evidence-backed alternatives.
- Preserve the original node obligation in single-node repairs and expose the selected strategic move in dispatch observations.

No new runtime, state store, authority, budget or agent identity. No generalized arbitrary graph editing in this change.
