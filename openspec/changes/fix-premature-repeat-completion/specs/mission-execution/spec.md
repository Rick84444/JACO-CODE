## MODIFIED Requirements

### Requirement: Duplicate mutations do not imply completion
The executor SHALL prevent replay of unchanged verified mutations and SHALL return planning feedback without declaring the mission complete.

#### Scenario: Planner repeats a verified mutation
- **WHEN** the next mutation duplicates the latest verified action in unchanged observed state
- **THEN** execution is skipped and the planning lease is released with a bounded failure, allowing another plan within existing limits.
