## ADDED Requirements

### Requirement: Bounded verified tool batches
Aura SHALL execute only advertised, authorized tool calls, with a bounded independent-read batch and distinct receipts. Invalid or failed batches SHALL NOT silently continue; unknown mutation outcomes SHALL NOT be replayed.

#### Scenario: Model emits tool-shaped source code
- WHEN a model emits TOOL_CODE rather than the supported JSON protocol
- THEN the runtime SHALL request valid tool syntax and SHALL NOT evaluate the source.

### Requirement: Windows npm setup
The Windows setup SHALL resolve npm's CLI script and invoke it with Node, without directly spawning npm.cmd or enabling a generic shell.

### Requirement: Canonical browser perception
Perception SHALL use the guarded browser MCP server and SHALL distinguish image capture from image interpretation.
