# Design

Use the current Node executable and installed npm CLI JavaScript on Windows, with explicit missing-CLI diagnostics. Preserve the existing explicit npm_execpath and non-Windows resolution. Route perception through canonical guarded browser MCP. Use bounded JSON TOOL_CALLS batches of independent read operations, sequential receipts, duplicate suppression within a batch, fail closed on malformed/unlisted/failed calls, and require re-observation after mutation. Never execute Python-like TOOL_CODE; request valid protocol instead. Preserve existing five tool rounds and add a twelve-call cap. No policy or approval changes.

Falsifiers: direct Windows npm.cmd spawn; wrong server; duplicate or unlisted invocation; tool-shaped code presented as executed; continuing a batch following failure; mutation in a read batch; more than twelve calls or five tool rounds. Unit tests are not Windows/live CDP verification.
