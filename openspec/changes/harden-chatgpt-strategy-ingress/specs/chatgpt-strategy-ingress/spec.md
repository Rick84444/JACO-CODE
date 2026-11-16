# ChatGPT strategy ingress — change specification

## ADDED Requirements

### Requirement: Locally authorized strategic admission
The JACO Git control ingress SHALL accept `strategy.graph.create` only after
an explicit local operator opt-in, and SHALL derive its allowed tasks, code paths,
test commands and budget caps from the local policy rather than the Git payload.

#### Scenario: Unapproved public strategy command
- **WHEN** a Git writer submits a strategy without a locally enabled policy
- **THEN** JACO SHALL reject it without creating a SEER graph, mission, permission,
  spending approval or model invocation on its behalf.

#### Scenario: Operator-approved graph
- **WHEN** an authorized, bounded, acyclic graph passes local checks
- **THEN** JACO SHALL create it in the existing Aura/SEER Mission Graph with a
  deterministic ID and SHALL expose only a bounded ID/status receipt in Git.

### Requirement: Evidence-gated task delegation
Aura SHALL remain the sole root agent. Delegated graph tasks SHALL run through
the existing SEER graph dispatcher and Nova Mission Bus without a replacement runtime.

#### Scenario: Dependent task waits
- **WHEN** a downstream task depends on a node without verified evidence
- **THEN** it SHALL remain blocked until the prerequisite is VERIFIED.

### Requirement: No authority through ChatGPT Agent Card
The ChatGPT Workplace relay MUST remain communication-only; public Git messages
MUST NOT grant mission creation, approval, claim, deployment, arbitrary tests,
unrestricted code paths, funds transfer or access to private secrets.

#### Scenario: Git requests dynamic test execution
- **WHEN** a graph contract sets `allow_workspace_tests=true` or supplies a test
  command absent from the local operator allowlist
- **THEN** JACO SHALL force dynamic test execution off or reject the command.

### Requirement: Missing graph cannot poison command intake
The Git control inbox MUST tolerate a tracked SEER graph that is no longer found
without stopping refresh or admission of subsequent valid commands.

#### Scenario: Graph deleted or service reset
- **WHEN** the graph reader returns a confirmed not-found result for a tracked ID
- **THEN** its receipt SHALL become `UNVERIFIED` with phase `GRAPH_MISSING`,
  an allowlisted error code and no false DONE claim, while other commands
  continue to be accepted and checked exactly once.

#### Scenario: Transient service outage
- **WHEN** the graph query fails with a network or authorization exception
- **THEN** JACO SHALL NOT convert that exception into successful completion or
  infer that the graph has been deleted.

### Requirement: Host proof is separate from CI
Implementation and mocks MUST NOT be presented as a live ChatGPT connection or
a verified autonomous Windows run.

#### Scenario: PR merged but Windows checkout is older
- **WHEN** source CI passes but no installed-runtime agent session and graph run
  have been observed
- **THEN** the release status SHALL remain UNVERIFIED on that host.
