## ADDED Requirements

### Requirement: Local ChatGPT plan access
The runtime SHALL use the official SIWC flow for eligible requests and keep authentication tokens under the user's control.
#### Scenario: Authorized account
- **WHEN** the user completes verified sign-in and grants plan usage
- **THEN** the runtime may send eligible Responses API requests for that user.
#### Scenario: Denied or revoked permission
- **WHEN** plan consent is absent or revoked
- **THEN** the runtime SHALL stop plan inference and expose reconnect status without paid fallback.
#### Scenario: Background execution
- **WHEN** a background mission requests plan usage without explicit consent
- **THEN** the runtime SHALL reject the request.

### Requirement: Gemini project access
The runtime SHALL accept supported Google AI Studio credential types using the existing protected credential flow and verify real access before reporting ready.
#### Scenario: New authorization key
- **WHEN** the operator provides a valid current authorization key
- **THEN** the runtime SHALL identify Gemini and validate the key with the supported Gemini API transport.
#### Scenario: Billing boundary
- **WHEN** a Gemini project is unavailable or quota is exhausted
- **THEN** the runtime SHALL report the condition without claiming consumer subscription entitlement or enabling paid billing.

### Requirement: Provider credential isolation
The runtime SHALL not expose secrets to model context, cloud relay, UI, logs or unrelated accounts.
#### Scenario: Remote client
- **WHEN** the Android PWA requests provider status
- **THEN** it SHALL receive redacted connection status only.

### Requirement: Official CLI boundary
The runtime SHALL treat external CLI agents as delegated tools, not extract their subscription credentials or impersonate their service clients.
#### Scenario: CLI entitlement unavailable
- **WHEN** a CLI is not installed or the selected integration lacks a supported account or permitted usage
- **THEN** JACO SHALL expose the unavailable condition without attempting private endpoints or paid fallback.
