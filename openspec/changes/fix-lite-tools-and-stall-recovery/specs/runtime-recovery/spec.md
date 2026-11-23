# Runtime recovery delta

### Requirement: Bundled tool path is inherited by Lite children
The Lite launcher SHALL make the directory containing its selected Node executable available in PATH to its Workplace, IDE and agent child processes. It MUST preserve previously configured PATH entries and avoid duplicates, and MUST NOT widen agent command permissions.

#### Scenario: Pixel Terminal uses a private Node
- **WHEN** the JACO launcher was started using a private Node executable whose bin directory is absent from PATH
- **THEN** each JACO child environment contains that bin directory so npm tools can be resolved when supplied by that runtime.

#### Scenario: Windows-style environment key
- **WHEN** a Windows environment uses `Path` instead of `PATH`
- **THEN** the launcher preserves that variable and does not create an ambiguous second PATH key.

### Requirement: Missing-tool cycles must not masquerade as progress
The existing mission stuck detector SHALL flag recurring executions that fail due to the same missing executable, even when interspersed with successful source reads. It SHALL NOT classify a recovered successful tool execution as the same unchanged blocker.

#### Scenario: Repeated npm failures
- **WHEN** the contracted npm test fails at least three times because npm cannot be launched, with reads between failures
- **THEN** the existing mission loop receives a stuck diagnosis and proceeds through its bounded recovery path instead of indefinitely revisiting files.

#### Scenario: Working tool restored
- **WHEN** the previously missing executable later succeeds
- **THEN** earlier missing-tool failures do not force a stale stuck verdict.
