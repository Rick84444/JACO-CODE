## MODIFIED Requirements

### Requirement: Durable host authorization at WebSocket admission

The Render JACO Link adapter SHALL re-read durable per-device revocation state after HTTP upgrade authorization and before adding a host WebSocket to the active room. It MUST serialize that recheck with account-level revocation and message dispatch, MUST reject a revoked host, and MUST fail closed if the durable store is unavailable. The adapter MUST NOT dispatch messages from unadmitted sockets.

#### Scenario: Revocation occurs between upgrade authorization and acceptance

- **WHEN** a signed host has passed the HTTP upgrade authorization, the device is revoked, and the WebSocket is then accepted
- **THEN** the adapter closes the socket with code 4003 and does not add it to the active host socket set

#### Scenario: Durable check passes

- **WHEN** the device is not revoked and the persistent lookup succeeds
- **THEN** the open host socket is admitted, subject to the existing one-host-per-device rule

#### Scenario: Persistent state cannot be checked

- **WHEN** the durable revocation lookup fails after HTTP upgrade
- **THEN** the adapter closes the socket and does not grant message dispatch
