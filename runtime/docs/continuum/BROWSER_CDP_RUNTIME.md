# Browser / CDP Runtime

JACO uses CDP as a native browser transport while keeping a semantic JACO API above it.

Default discovery: `http://127.0.0.1:9222/json` and `/json/version`.

The runtime compiles raw browser observations into a compact state, computes deltas, and executes bounded batches under an Execution Lease. Consequence classes and operator checkpoints can stop a batch before irreversible actions. Raw secrets are not a memory primitive.

Android normally requires an ADB forward from `localabstract:chrome_devtools_remote` to loopback `9222`. The candidate does not expose port 9222 to the LAN.
