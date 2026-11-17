## ADDED Requirements

### Requirement: Shared project contract
The runtime SHALL use one generated project contract policy in Lite and full JACO; explicit restrictions and mandatory verification SHALL remain effective.

#### Scenario: New document in a tested repository
- **WHEN** the operator requests creation of an isolated document or demo
- **THEN** the generated ticket SHALL NOT demand unrelated repository tests, while requiring actual change evidence and any applicable commit.

#### Scenario: Explicit read-only and no-network scope
- **WHEN** the operator restricts the goal
- **THEN** Lite SHALL preserve the same allowed task restrictions as full project mode.

### Requirement: Contracted recovery
Nova SHALL honor the authorized consecutive failure allowance, preserve repeat-action stop thresholds and fail closed on unknown outcomes.

#### Scenario: Distinct recoverable failures
- **WHEN** separate known failures occur below the contract limit
- **THEN** the same mission remains eligible for another step without an additional operator decision.

### Requirement: Bounded completion review
The canonical mission resolver SHALL bound optional model-based claim review time, preserve rule-based evidence and report unavailable judgment.

#### Scenario: Optional judge offline
- **WHEN** the secondary judge is unavailable
- **THEN** the resolver SHALL report the missing model judgment without indefinitely gating an otherwise supported answer, and SHALL NOT approve contradicted or unsupported claims.
