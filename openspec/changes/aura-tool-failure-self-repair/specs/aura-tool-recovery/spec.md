## ADDED Requirements

### Requirement: Failed tools are diagnosed before the next decision
After a tool step fails with a known outcome, Aura SHALL gather evidence and give the model a classified diagnosis with a concrete next step before its next decision.

#### Scenario: Stopped MCP server
- **WHEN** a tool step fails with `MCP_SERVER_EXITED`
- **THEN** Aura SHALL request a start of that configured server and include its status and recent log lines in the diagnosis
- **AND** the diagnosis SHALL reach the model before its next tool call

#### Scenario: Diagnosis is bounded
- **WHEN** the same failure repeats
- **THEN** Aura SHALL diagnose it once and SHALL NOT diagnose more than four failures in one run

### Requirement: Remedies are safe and never bypass authority
Diagnosis SHALL only start already configured services and SHALL NOT retry failures with unknown outcome or work around credential, permission, approval or budget failures.

#### Scenario: Permission failure
- **WHEN** a tool fails with a permission or approval error
- **THEN** the diagnosis SHALL direct the model to the operator and SHALL start nothing

#### Scenario: Local stack recovery is rate limited
- **WHEN** a local service does not answer repeatedly
- **THEN** Aura SHALL request launcher recovery at most once per cooldown period
