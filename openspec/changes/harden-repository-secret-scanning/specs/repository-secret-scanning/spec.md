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

### Requirement: Compact private-key blocks and legacy encodings

Recognizable private-key blocks SHALL be detected independent of key algorithm
and payload length. ASCII credential markers embedded in non-UTF-8 source
files SHALL be inspected, not silently classified as binary.

#### Scenario: Ed25519 private key

- **WHEN** a tracked file contains an Ed25519 PKCS#8 PEM private key
- **THEN** the scanner SHALL reject it without logging the key.

#### Scenario: Latin-1 source fixture

- **WHEN** a tracked Latin-1 text file contains a recognizable provider token
- **THEN** the scanner SHALL reject it despite non-UTF-8 characters.
