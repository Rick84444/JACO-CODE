## ADDED Requirements
### Requirement: Pinned public OAuth pilot
The runtime authorization primitive SHALL validate provider-owned metadata and request only the read scope with PKCE S256 and issuer/state verification. It SHALL not expose tokens to UI or register an MCP server before separate verified onboarding.
#### Scenario: Metadata or scope mismatch
- WHEN returned resource, issuer, endpoints or granted scope violate the reviewed contract
- THEN fail closed without continuing the authorization flow or reporting a verified connection.
