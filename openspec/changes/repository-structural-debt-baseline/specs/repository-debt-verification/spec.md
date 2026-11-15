# Repository structural-debt verification

## Purpose

This capability makes technical-debt evidence reproducible and auditable for each repository revision while preserving clear boundaries between static inventory, code integration tests and installed-host verification.

## ADDED Requirements

### Requirement: Complete tracked-tree inventory

The repository's debt verification SHALL enumerate every tracked blob at the checked-out Git HEAD and SHALL report the revision, inventory scope and exact duplicate groups. It SHALL fail with an explicit error if the inventory cannot be read.

#### Scenario: Duplicate content in multiple paths
- **WHEN** two or more tracked files have an identical Git blob object ID
- **THEN** the inventory SHALL report the group and full file paths
- **AND** it SHALL NOT infer which copy is safe to delete solely from content equality

#### Scenario: Empty or unavailable Git tree
- **WHEN** Git cannot enumerate the HEAD tree
- **THEN** the verification SHALL fail without claiming the repository was inspected

### Requirement: Distinguish static evidence from runtime verification

The debt inventory SHALL explicitly distinguish tracked-file evidence from semantic caller/import analysis, dependency vulnerability/freshness analysis and real device/runtime tests. A successful inventory SHALL NOT report zero architectural debt.

#### Scenario: No duplicate hashes found
- **WHEN** an inspected tree contains no identical blobs
- **THEN** the audit SHALL still report that semantic duplication, dependency age and host behavior are not verified

### Requirement: Preserve canonical system ownership

Every removal or consolidation of a runtime/agent/planner/mission-store/launcher implementation SHALL identify its canonical owner, inbound callers, compatibility consumers, durable state and migration path before removal.

#### Scenario: Historical API or executable is still a consumer boundary
- **WHEN** a legacy path is read by installed Windows, Termux, VS Code, mobile or third-party clients
- **THEN** removal SHALL wait for migration and regression tests

### Requirement: Explicit debt closure gates

Every confirmed high-priority debt item SHALL remain OPEN until its linked OpenSpec task has the code change, syntax/test evidence, affected CI gate and applicable installed-host proof. Merely making CI green SHALL NOT close target-host behavior claims.

#### Scenario: Windows service startup repaired in source
- **WHEN** a patch claims unattended restart after install
- **THEN** the task SHALL remain unresolved until a real Windows install/restart/mission continuity acceptance has been observed

### Requirement: Safe treatment of mirror content

Files copied into multiple distribution roots SHALL be classified as candidate mirrors. Deleting or consolidating a mirror SHALL require a proven source of truth, build packaging check, and tests for every affected distribution target.

#### Scenario: Public asset exists at two paths
- **WHEN** identical web assets appear at public/ and runtime/public/
- **THEN** the scanner SHALL report the pair as a distribution mirror without removing either copy

### Requirement: Dependency currency requires evidence

An outdated or vulnerable dependency SHALL be recorded only from a dated, inspectable package registry, security advisory, lockfile audit or authoritative upgrade PR; the presence of two versions in different packages alone SHALL NOT be treated as a defect.

#### Scenario: Open dependency update PR
- **WHEN** an upgrade PR exists but no compatibility/security test or update has landed
- **THEN** its status SHALL be reported as outstanding update work rather than a confirmed exploitable vulnerability
