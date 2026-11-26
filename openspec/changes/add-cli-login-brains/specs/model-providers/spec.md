## ADDED Requirements

### Requirement: CLI-login providers
The runtime SHALL expose a signed-in vendor CLI as a model provider without reading, storing or forwarding the CLI's credentials.

#### Scenario: Signed-in CLI is active
- **WHEN** the CLI reports it is signed in
- **THEN** the provider scan lists it as active and a chat request returns the CLI's completion text

#### Scenario: Signed-out CLI fails closed
- **WHEN** the CLI reports it is not signed in or exits non-zero
- **THEN** the provider is not active and a chat request throws without retrying

#### Scenario: API keys cannot override a subscription
- **WHEN** the CLI is started
- **THEN** its environment contains no API-key variable and the prompt is sent on stdin
