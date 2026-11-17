## MODIFIED Requirements

### Requirement: Duplicate mutations do not imply completion
The executor SHALL prevent replay of unchanged verified mutations and SHALL return planning feedback without declaring the mission complete.

#### Scenario: Planner repeats a verified mutation
- **WHEN** the next mutation duplicates the latest verified action in unchanged observed state
- **THEN** execution is skipped and the planning lease is released with a bounded failure, allowing another plan within existing limits.

### Requirement: Browser mutations have observable postconditions
The executor SHALL reject a browser click before dispatch when it has no expected URL or selector, so an uncertain browser outcome is never created by a missing verification contract.

#### Scenario: Click lacks an expectation
- **WHEN** a planner proposes `browser-click` without `expect.url` or `expect.selector`
- **THEN** the executor returns `BROWSER_CLICK_EXPECTATION_REQUIRED` without sending browser input.
