## ADDED Requirements

### Requirement: Source-aligned product builds
Lite and the full Windows installer SHALL build from the same main source commits for shared product changes, and each installer SHALL expose its source commit.

#### Scenario: Canonical runtime change
- **WHEN** a relevant change lands on main
- **THEN** both release workflows SHALL be triggered with the same source SHA, and the full Windows payload SHALL include matching version and commit metadata.
