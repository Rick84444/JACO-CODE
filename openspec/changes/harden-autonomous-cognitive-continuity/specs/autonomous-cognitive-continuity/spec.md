## ADDED Requirements

### Requirement: Durable operator authority
The runtime SHALL preserve active signed grants across restarts and SHALL NOT extend an expired grant without an explicit operator signature.

#### Scenario: Restart after expiry
- **WHEN** a signed mandate expires and the runtime restarts
- **THEN** its expiry is unchanged and it cannot authorize actions until signed again.

### Requirement: Comparable evidence-driven candidates
The runtime SHALL normalize positive-weight metrics before ranking and exclude incomplete candidates from selection, preserving evidence validation.

#### Scenario: Unit changes
- **WHEN** a metric is converted to another positive linear unit for all candidates
- **THEN** candidate ordering is unchanged.

### Requirement: Complete knowledge retrieval
The runtime SHALL apply result limits after relevance ranking across all readable knowledge objects.

#### Scenario: Lower confidence match
- **WHEN** a matching object lies outside the first thousand confidence-ranked objects
- **THEN** the query can retrieve it if eligible.

### Requirement: Retryable archival
The runtime SHALL retry failed commercial archives independently of learned status and SHALL allow other mission learning to proceed.

#### Scenario: Archive error
- **WHEN** one archive write fails
- **THEN** the mission remains eligible for archival and independent work continues.
