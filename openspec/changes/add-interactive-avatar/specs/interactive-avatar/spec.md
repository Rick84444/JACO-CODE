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
The avatar SHALL use actual speech audio to drive visemes and SHALL deform the active avatar's actual skinned facial geometry. Particles are specific to the legacy lightform and are not required for anatomical V31.
#### Scenario: Speech playback
- **WHEN** supported speech audio plays
- **THEN** facial movement SHALL follow speech; legacy lightform particles, when enabled, SHALL follow deformation.
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

### Requirement: Aura V31 anatomical candidate
- The existing portrait canvas, camera framing, chat, voice and mission controls SHALL remain intact.
- V31 SHALL use its original rig, materials and textures; the legacy lightform's mesh names, exact byte size and particle counts SHALL NOT be imposed on V31.
- V31 SHALL be pinned to 45304080 bytes and SHA-256 ea9c4646cf197f042fa4a39ea8ecd5a438adb1b0865c8eddb0749d0915bd6129. Validate glTF 2.0, required bones and non-empty facial morphs.
- A missing or invalid V31 SHALL retain the existing lightform and SHALL NOT report V31 readiness.
- Structural verification is distinct from visual acceptance. Production activation requires actual GUI rendering, consistent portrait scale, speech/motion, Windows and Android performance, asset rights and operator visual approval. Keep the existing lightform as rollback.

### Requirement: Audio-clock facial motion for V31
When decoded speech audio is available, the renderer SHALL sample all 14 authored visemes from the media playback clock, preserve a bounded coarticulation envelope and prioritize bilabial closure over jaw opening. Silence, interruption and new audio parts SHALL invalidate stale motion. The renderer SHALL use only locally analyzed audio or explicit inputs; synthetic cadence SHALL NOT be labeled lip sync for V31. Browser speech or missing analysis must degrade without changing audible playback. The experimental English-trained classifier SHALL NOT be represented as validated Swedish phoneme alignment without held-out audio/visual testing.
