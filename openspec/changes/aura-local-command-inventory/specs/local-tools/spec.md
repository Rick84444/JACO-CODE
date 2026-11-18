## ADDED Requirements

### Requirement: Observed local command availability
The canonical shell SHALL distinguish executable discovery from policy authorization and execution evidence.

#### Scenario: Host-specific tools
- WHEN an authorized caller requests shell_info
- THEN return actual executable names discovered from absolute PATH entries, bounded and searchable, without exposing environment values or invoking programs
- AND preserve all existing read/write and mission constraints.

### Requirement: Immediate usable local tools
Built-in JACO Shell SHALL default to write access, with existing explicit operator restrictions taking precedence. Discovered known programs SHALL include purpose, example arguments and execution status distinct from capability knowledge.

#### Scenario: First start and semantic tool search
- WHEN the operator starts Aura without custom shell access configuration
- THEN shell_info, shell_read and shell_run are available to a mission with the respective authorized task types
- AND shell_info supports a search by purpose as well as by name
- AND unknown executables are not represented as tested or understood.
