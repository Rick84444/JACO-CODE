## ADDED Requirements

### Requirement: Evidence-adaptive strategic context
Aura SHALL recompute tactical recommendations from current durable mission observations before each model planning turn. The Gameboard SHALL display the same recommendations, explicitly as hypotheses rather than executable steps. Unknown outcomes SHALL NOT recommend retry. Operator steering SHALL retain its existing revision and authority boundary.

### Requirement: Bounded graph repair selection
The graph repair planner SHALL compare up to five admissible alternatives from a single proposal response using the shared Gameboard scoring. Replacement SHALL preserve the failed node's original objective, contract, dependencies and verification requirements. Selection rationale SHALL be persisted in canonical replan history. No permissions or execution budget are granted by forecast metrics.
