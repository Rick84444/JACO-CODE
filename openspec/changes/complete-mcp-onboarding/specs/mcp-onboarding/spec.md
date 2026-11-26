## ADDED Requirements
### Requirement: Verified guided connection
The runtime SHALL connect supported catalog services via the canonical MCP host and persist a credential only after a successful scoped read probe; setup SHALL be denied for unsupported providers and existing configurations without an explicit repair path.
#### Scenario: Authentication or probe fails
- WHEN the provider rejects the credential or the read probe cannot be verified
- THEN the new configuration and credential SHALL NOT be saved, and the operator SHALL receive a bounded failure state.
#### Scenario: Scoped credential
- WHEN a guided credential is stored
- THEN it SHALL NOT be exported to child process environments and SHALL be usable only with the pinned provider endpoint.
