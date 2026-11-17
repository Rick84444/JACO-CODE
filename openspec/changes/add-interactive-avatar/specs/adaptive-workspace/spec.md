## ADDED Requirements
### Requirement: Compact default workspace
The existing chat SHALL remain the primary surface with a compact expandable live terminal. The desktop SHALL present selected tools in a right-hand workspace; Android SHALL offer a responsive single-panel presentation with persistent chat access.
#### Scenario: Assistant opens a tool
- **WHEN** an authenticated runtime event identifies an available tool
- **THEN** the existing tool view SHALL open without interrupting chat or mission execution.
### Requirement: Terminal rendering
The terminal SHALL display observed execution output, preserve ordering and reconnect without inventing output. A terminal renderer SHALL NOT grant additional shell authority.
#### Scenario: Terminal is collapsed
- **WHEN** the operator collapses the terminal during execution
- **THEN** execution SHALL continue and output SHALL be recoverable.
### Requirement: Browser presentation
Browser views SHALL reuse existing CDP target ownership and display the observed target identity. Remote content SHALL remain isolated from privileged application APIs.
#### Scenario: Embedding denied
- **WHEN** a site cannot be embedded
- **THEN** the application SHALL offer a supported remote browser view or external browser navigation without disabling browser security.
### Requirement: Provider presentation
Provider panels SHALL reuse existing registry and connection UI, displaying observed availability and model; opening a panel SHALL NOT change credentials, provider selection or spending authority.
#### Scenario: Provider unavailable
- **WHEN** a provider fails its existing health probe
- **THEN** the panel SHALL display the observed failure instead of claiming readiness.
### Requirement: Visual quality
The UI SHALL use a restrained obsidian palette, brushed-metal accents, crisp typography and subtle blue highlights. Avatar and background effects SHALL yield to readability and respect reduced-motion preferences.
#### Scenario: Mobile viewport
- **WHEN** the Android viewport is narrow
- **THEN** chat and controls SHALL remain legible without horizontal page scrolling.
