## ADDED Requirements

### Requirement: Named terminals
The runtime SHALL show each shell command Aura runs in the terminal she named, keeping a working folder per name, without changing which commands are allowed.
#### Scenario: Two tasks
- **WHEN** Aura runs commands in two named terminals
- **THEN** each keeps its own folder and history and the operator sees two windows.
#### Scenario: Refused command
- **WHEN** the shell refuses a command
- **THEN** the terminal shows it as failed and the folder is unchanged.
