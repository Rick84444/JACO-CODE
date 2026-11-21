# Aura Desktop live execution

### Requirement: One canonical screenshot source
Aura SHALL read a Windows frame from the existing `NOVA_STATE_DIR`-bounded Laser Vision capture, using the same resolver in the executor and runtime.

#### Scenario: A current desktop mission
- **WHEN** the current durable mission has `metadata.executor=desktop-agentos` and a fresh verified screenshot receipt matching the unchanged PNG
- **THEN** an authenticated operator with screen-view opt-in receives that exact PNG, timestamp and mission identifier without performing a new capture

#### Scenario: Unrelated or stale evidence
- **WHEN** the screenshot is expired, modified, post-mutated or belongs to an unrelated mission
- **THEN** the viewer SHALL fail closed, never represent the old image as live

### Requirement: Interactive guest execution
Aura SHALL require an authorized, observable interactive Windows application desktop and current foreground process/session identity before raw SendInput. Screenshots SHALL not claim live application perception from session 0, inaccessible/locked secure desktops or a different session.

#### Scenario: Noninteractive or locked input desktop
- **WHEN** the process runs in session 0 or the current input desktop is not the interactive Default desktop
- **THEN** screenshot/input SHALL return a bounded refusal before any mutation

### Requirement: Human takeover
Aura SHALL NOT claim exclusive operator control unless in-flight model execution has quiesced or been explicitly reconciled.

#### Scenario: Active mission being manually taken over
- **WHEN** the operator requests manual remote control during an executing mission
- **THEN** the GUI SHALL disclose that the mission must first be stopped/paused and confirmed quiescent, without automatically changing grants or bypassing ModelRelay

### Requirement: Physical acceptance
A code-build/CI pass SHALL NOT be presented as proof of live desktop control.

#### Scenario: No real guest available
- **WHEN** tests pass but no real Windows guest and Chrome Remote Desktop same-session receipts exist
- **THEN** physical execution, takeover and deployment SHALL remain UNVERIFIED
