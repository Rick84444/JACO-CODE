## ADDED Requirements
### Requirement: Read-only browser OAuth connector
The runtime SHALL discover and validate a reviewed provider's issuer and resource, register its own public client, bind OAuth callback to a one-use PKCE attempt, and verify a read operation before saving credentials. Tokens SHALL be scoped to that connector; no broadened authority or replay of dispatched calls.
#### Scenario: Authorization rejected or mismatched
- WHEN callback state, issuer, scope, resource or read verification fails
- THEN no new credential or server configuration SHALL be saved.
#### Scenario: Access token expiry
- WHEN the connector needs a new access token
- THEN refresh MAY occur with the previously granted read scope and issuer, without retrying an ambiguous tool call or exposing credentials.
