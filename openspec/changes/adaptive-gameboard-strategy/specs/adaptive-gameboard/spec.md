# Adaptive Gameboard

## ADDED Requirements

### Requirement: Evidence-driven strategy switching
Aura SHALL be able to request a replacement implementation approach for its assigned graph node without forced decomposition, preserving the operator's goal, contract, execution budget and verification requirements.

#### Scenario: Known better approach
- GIVEN a graph node with new evidence and a known outcome
- WHEN Aura requests replanning with zero subgoals and a reason
- THEN the existing graph repair mechanism SHALL select a replacement approach, retaining the original objective, contract, remaining budget and evidence references

#### Scenario: Outcome is uncertain
- GIVEN an action with an unknown outcome
- WHEN a strategy change is considered
- THEN existing reconciliation and quarantine controls SHALL remain authoritative; the request grants no permission to retry an uncertain mutation

### Requirement: Current strategic move selection
Aura SHALL obtain a fresh canonical ranking before each dispatch attempt within the existing bounded turn.

#### Scenario: Eligibility changes during dispatch
- GIVEN two or more ranked executable moves
- WHEN another move becomes ineligible during the first awaited dispatch
- THEN the next dispatch SHALL use the current ranking rather than the previous snapshot
- AND a previously attempted key SHALL not be attempted again in that turn
