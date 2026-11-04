# Browser / CDP Runtime

JACO uses CDP as a native browser transport while keeping a semantic JACO API above it.

Default discovery: `http://127.0.0.1:9222/json` and `/json/version`.

The runtime compiles raw browser observations into a compact state, computes deltas, and executes bounded batches under an Execution Lease. Consequence classes and operator checkpoints can stop a batch before irreversible actions. Raw secrets are not a memory primitive.

Android normally requires an ADB forward from `localabstract:chrome_devtools_remote` to loopback `9222`. The candidate does not expose port 9222 to the LAN.

## Identified browser writes (P0 slice)

The CDP MCP facade now requires `actionId` for `nova_navigate`, `nova_click`,
and `nova_type`. The ID (8–128 letters, digits, colons, underscores or hyphens)
is passed through to the Nova actuator. Nova claims a durable action record
**before** dispatching the browser operation; the default path is
`agents/.agent-state/cdp-actions/`, configurable via `JACO_CDP_ACTION_DIR`.

- Same ID and identical payload after verified execution: returns the stored
  verification receipt **without** executing again.
- Same ID with different payload: `ACTION_ID_CONFLICT` and no execution.
- Pending, unverified, timed-out or corrupted records: blocked until an
  independent readback and explicit reconciliation; no automatic retry.
- Journal records contain a hash of the operation and a receipt ID, not raw
  browser input, page content or credentials.
- The claim file **and its directory entry** must be flushed before dispatch.
  The verified receipt file and final rename must also be flushed before
  acknowledging success. The entire ancestor chain is flushed on every attempt, including retries after an interrupted directory creation.
  If directory fsync is not supported by the filesystem or platform, identified
  browser writes fail closed rather than making a crash-durability promise.
  Windows and Android physical-host semantics still require targeted acceptance
  tests; network filesystems are not covered by this local-journal guarantee.
- The MCP facade requires a verified postcondition for a successful mutating
  tool response. A transport-level acknowledgement is not proof of effect.

This is **at-most-once dispatch**, not guaranteed completion or an atomic
external transaction. It protects identified calls arriving at the same
actuator state directory, not independent hosts. **Legacy direct HTTP calls
without an action ID are still accepted** for compatibility and therefore
remain outside the guarantee. Closing that bypass and providing a safe
reconciliation workflow are separate migration gates before general plugin
autonomy. No live Chrome/CDP or marketplace publish test is implied.
