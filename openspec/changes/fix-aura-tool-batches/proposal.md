# Fix Aura tool batches and Windows setup

Observed Windows setup fails with `spawnSync npm.cmd EINVAL`; perception aliases call `cdp` when the canonical MCP server is `browser`; chat displays Python-like TOOL_CODE instead of executing, and handles only the first TOOL_CALL. Repair existing owners; no new runtime, authority, or provider.
