## ADDED Requirements

### Requirement: Grounded computer observation and truthful input dispatch
Aura SHALL consume only current mission-attested visual evidence, and native input SHALL report accepted dispatch or an explicit failure, not assert an application outcome.

#### Scenario: Stale frame or target
- WHEN an intervening action or stale observation invalidates the frame
- THEN the planner SHALL not receive that image as current evidence
- AND Track SHALL require fresh identification before action.
