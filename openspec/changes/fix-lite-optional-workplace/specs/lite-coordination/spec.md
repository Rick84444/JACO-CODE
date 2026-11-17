## ADDED Requirements

### Requirement: Local Lite coordination is optional
The isolated Lite launcher SHALL attempt its own local Workplace service without requiring an operator-supplied API token; unrelated local operations SHALL remain available when optional coordination is unavailable. Explicit strict mode SHALL retain the existing startup requirement. Authenticated external operations SHALL retain their existing authorization.

#### Scenario: Optional Workplace unavailable
- **WHEN** the local Lite Workplace does not start or cannot synchronize and strict mode is not requested
- **THEN** local work may continue with truthful degraded coordination status; no remote session or permission is invented.

#### Scenario: Strict coordination requested
- **WHEN** JACO_WORKPLACE_REQUIRED is explicitly set to 1 and local Workplace cannot be verified
- **THEN** startup remains blocked.

### Requirement: Capability-specific health
Lite SHALL distinguish absent optional standalone services from required service failures and use the actual selected Workplace port. Aura SHALL evaluate blockers against the requested action and not infer Git-relay health from SEER or Gateway status.

#### Scenario: Standalone services not shipped
- **WHEN** Lite has no separately configured SEER or gateway and its corresponding listener is unavailable
- **THEN** the service is reported as NOT_SUPERVISED, not as a global blocker.
