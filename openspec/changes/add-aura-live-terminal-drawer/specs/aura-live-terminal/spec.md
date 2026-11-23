# Aura Live Terminal

## ADDED Requirements

### Requirement: On-demand human narration panel
The canonical Aura GUI SHALL provide an on-demand Live Terminal panel whose default view displays recent, real, human-readable mission events from the *existing* CognitiveLive feed. Closing or opening the panel MUST NOT change the mission, start a new event stream, grant permissions, or execute a tool.

#### Scenario: Open while Aura works
- **WHEN** an operator opens Live Terminal while an Aura mission has durable progress events
- **THEN** the panel shows that mission's observed human-language steps, timestamps, known evidence outcomes and connection state without inventing completion.

#### Scenario: No observed progress
- **WHEN** no matching event has been received
- **THEN** the panel explicitly reports that no steps have yet been observed rather than synthesizing activity.

### Requirement: Original command receipts remain accessible
The panel SHALL display the existing read-only `AuraTerminal` command receipts in a separate Commands tab and SHALL remove that terminal from the embedded Live Stage, without affecting the IDE's authorized terminal runner.

#### Scenario: Switch between views
- **WHEN** the operator switches from Activity to Commands and back
- **THEN** raw stdout/stderr only appears in Commands and the Activity view remains human-readable.

### Requirement: Recoverable responsive presentation
The panel SHALL be dismissible from desktop and phone, SHALL have accessible labels and SHALL not interrupt the chat or an ongoing mission.

#### Scenario: Dismiss
- **WHEN** the operator closes the Live Terminal
- **THEN** the existing conversation, mission and command session continue unchanged.
