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

Remaining bottleneck: MCP tool RPC has a 25-second timeout while the workbench
client times out after 10 seconds. A stalled observation can outlive its caller.
The fabric cache stores completed values, not in-flight work, so concurrent
clients may duplicate these probes. This needs a separate bounded observation
lifecycle; do not label cached or timed-out browser observations live.

Validation: runtime TypeScript check and 23 device/GUI regression tests passed.
No phone profiling or real inference timing was performed. These are code-level
causes, not measured claims about total latency or tokens per second.
