## ADDED Requirements

### Requirement: Bounded gig access
Aura SHALL discover jobs using an existing tool registry. External application writes SHALL require local activation and the existing mission write authority.

#### Scenario: Missing local write mandate
- **WHEN** the write flag is absent
- **THEN** application tools SHALL be hidden and refuse execution.

#### Scenario: Ambiguous application
- **WHEN** an external mutation has an unknown outcome
- **THEN** the adapter SHALL require reconciliation and SHALL NOT resubmit blindly.

### Requirement: Metadata-only discovery
Public API discovery SHALL NOT acquire credentials or claim verified connectivity from an observed specification.

#### Scenario: Invalid discovery evidence
- **WHEN** a response is truncated or from another origin
- **THEN** it SHALL NOT establish an observed API specification.
