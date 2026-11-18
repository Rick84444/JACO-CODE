## ADDED Requirements

### Requirement: Observed local command availability
The canonical shell SHALL distinguish executable discovery from policy authorization and execution evidence.

#### Scenario: Host-specific tools
- WHEN an authorized caller requests shell_info
- THEN return actual executable names discovered from absolute PATH entries, bounded and searchable, without exposing environment values or invoking programs
- AND preserve all existing read/write and mission constraints.
