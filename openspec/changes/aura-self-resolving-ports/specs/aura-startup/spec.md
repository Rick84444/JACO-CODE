## ADDED Requirements

### Requirement: Foreign port conflicts resolve without operator action
Activation SHALL select a free alternative port when a foreign process holds a service port, and SHALL NOT terminate that process.

#### Scenario: Foreign listener on the runtime port
- **WHEN** a non-JACO process listens on the default runtime port during activation
- **THEN** activation SHALL choose another free port and start the runtime there
- **AND** every dependent service SHALL receive the resolved port

#### Scenario: Resolution is reported
- **WHEN** a port was reassigned
- **THEN** startup status SHALL name the service, the original port and the resolved port

### Requirement: Owned unhealthy services recover automatically
An unhealthy listener owned by this JACO instance SHALL be recycled by the existing guardian without operator action.

#### Scenario: Owned runtime stops answering
- **WHEN** the owned runtime fails health probes beyond the guardian threshold
- **THEN** the guardian SHALL restart it and report the recovery
