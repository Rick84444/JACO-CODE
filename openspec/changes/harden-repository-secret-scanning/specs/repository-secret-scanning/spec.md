## ADDED Requirements

### Requirement: Source and fixture secret inspection

Every tracked text source, test, example and configuration file SHALL be
included in an automated secret-pattern check. No path-based exemption SHALL
exclude a tracked text file.

#### Scenario: Secret-shaped test fixture

- **WHEN** a tracked test fixture contains a GitHub token or provider secret
- **THEN** the pre-merge check SHALL fail and identify the path and category
  without revealing the matched value.

### Requirement: Fail-closed audit

The scanner SHALL fail if Git's file index or any tracked text file required
for inspection cannot be read. Binary files MAY be skipped only after checking
their contents as binary.

#### Scenario: Missing tracked file

- **WHEN** a tracked file cannot be read
- **THEN** the scan SHALL fail rather than claim the checkout is secure.

### Requirement: CI gate

Every pull request against `main` and main push SHALL run the source secret
check with read-only repository permissions.

#### Scenario: New provider credential committed

- **WHEN** a proposed change includes a credential matching a supported
  pattern
- **THEN** the security gate SHALL fail before the PR can be considered green.

### Requirement: Honest history scope

The current-tree scan SHALL NOT be described as a complete Git history audit.

#### Scenario: Current tree clean but historical credential unknown

- **WHEN** current-tree checks pass
- **THEN** documentation SHALL still state that previously published secrets
  require separate history inspection and rotation when found.
