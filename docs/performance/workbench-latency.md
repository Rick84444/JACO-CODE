# Workbench latency audit — 2026-10-25

Source-confirmed issues corrected:

- Independent Git, MCP, workplace and planner health observations were awaited
  sequentially. They now start together. This removes additive wait, not the
  slowest observation's latency.
- Client snapshot publication waited for the file inventory (up to its 10-second
  timeout). Snapshot publication now occurs when its own request resolves.
- Devices rendered every second without an invitation. The countdown now runs
  only for an invitation, stops at expiry and skips hidden-page updates.
- Device polling could overlap and had no timeout. Reads now have an in-flight
  guard and 10-second timeout; hidden pages skip automatic reads.

MCP follow-up fix: automatic fabric observations now share a four-second abort
signal across health, tool discovery and observation RPCs. Explicit tool execution
keeps its existing timeout. Concurrent readers share in-flight observation work;
the 2.5-second cache lifetime starts on completion. Configuration invalidation
prevents an older pending response from repopulating the cache. Timed-out providers
are unavailable with MCP_OBSERVATION_TIMEOUT, even when health previously passed.
Ten targeted integration/cache tests passed, covering coalescing, completion-based
TTL, retry after failure and invalidation races. Runtime TypeScript checks passed.

Validation: runtime TypeScript check and 23 device/GUI regression tests passed.
No phone profiling or real inference timing was performed. These are code-level
causes, not measured claims about total latency or tokens per second.
