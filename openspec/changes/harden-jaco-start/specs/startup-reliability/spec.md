## ADDED Requirements

### Requirement: Canonical startup
JACO SHALL expose one canonical desktop start path and reuse the existing setup and runtime owners.

#### Scenario: Missing dependencies
- **WHEN** a supported desktop installation has missing dependencies
- **THEN** startup prepares them using the existing setup path or reports an actionable blocking error without claiming readiness.

### Requirement: Observed readiness
JACO SHALL report readiness only for observed required capabilities and identify optional failures explicitly.

#### Scenario: Optional capability unavailable
- **WHEN** an optional capability fails and all required capabilities are verified
- **THEN** the runtime remains usable with a degraded capability status.

#### Scenario: Required capability fails
- **WHEN** runtime identity or a required provider probe fails
- **THEN** startup does not report full readiness.

### Requirement: Safe recovery
JACO SHALL preserve durable mission state, authentication and process ownership during bounded recovery.

#### Scenario: Owned service failure
- **WHEN** an owned service fails during startup or operation
- **THEN** recovery is bounded and verified without losing durable mission state or replaying unknown external actions.

#### Scenario: Foreign listener or invalid credential
- **WHEN** a foreign process occupies a port or an explicit credential is invalid
- **THEN** JACO does not terminate that process or bypass authentication and reports actionable status.

### Requirement: Shared client identity
Desktop and Android remote clients SHALL observe the same canonical runtime identity and mission state when connected.

#### Scenario: Remote reconnection
- **WHEN** a remote client reconnects after desktop restart
- **THEN** it observes the verified runtime identity and recovered mission state or an explicit unavailable state.
