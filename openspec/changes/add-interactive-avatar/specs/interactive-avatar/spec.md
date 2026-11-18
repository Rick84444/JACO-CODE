## ADDED Requirements
### Requirement: Adaptive avatar presentation
The application SHALL retain its existing chat and compact terminal as the normal working surface and SHALL present the avatar on operator request or explicit communication events.
#### Scenario: Operator summons avatar during mission
- **WHEN** the operator opens and dismisses the avatar while a mission is running
- **THEN** the mission SHALL continue without cancellation or duplicate execution.
#### Scenario: Routine progress
- **WHEN** routine progress arrives
- **THEN** it SHALL remain in chat without opening the avatar.
### Requirement: Audio-driven facial animation
The avatar SHALL use actual speech audio to drive visemes and shall animate particles attached to facial geometry.
#### Scenario: Speech playback
- **WHEN** supported speech audio plays
- **THEN** facial movement SHALL follow speech and particles SHALL follow deformation.
### Requirement: Cross-platform graceful degradation
The existing desktop and Android clients SHALL share the avatar component and preserve chat when rendering or audio is unavailable.
#### Scenario: Unsupported GPU
- **WHEN** graphics initialization fails
- **THEN** chat and mission controls SHALL remain usable without reporting avatar readiness.
### Requirement: Resource lifecycle
The renderer SHALL pause or dispose of resources when the avatar is dismissed or the document is hidden.
#### Scenario: Dismissal
- **WHEN** the avatar is dismissed
- **THEN** continuous avatar rendering SHALL stop and the normal work surface SHALL remain available.
