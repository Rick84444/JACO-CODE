# Cloudflare MCP verification

Observed 2026-10-10. The canonical read-only Cloudflare MCP consumes credentials from its process environment or JACO's encrypted SecretStore. The store is read at call time; it does not require restarting the whole runtime. A dedicated CLOUDFLARE_READ_API_TOKEN takes precedence over a stored CLOUDFLARE_API_TOKEN. Account identity is CLOUDFLARE_ACCOUNT_ID. Tokens are never returned by the MCP.

The launcher continues withholding deployment credentials from background processes. No launcher policy was relaxed and no new Cloudflare permission was granted. The MCP only supports verify_connection and list_workers. Missing credentials, authentication, permission, rate limit, timeout, network and invalid-response failures have distinct bounded error codes.

Executed through the running local workbench MCP endpoint:

- verify_connection: HTTP 200, connected true, status active.
- list_workers: HTTP 200, 29 workers observed, including jaco-site, jaco-landing and jaco-mcp-bridge.
- MCP call feedback: outcome ok with timestamp and duration for both calls.
- node --test tests/nova/cloudflare-read-mcp.test.mjs tests/nova/mcp-host.test.mjs: 14 passed.

Public distribution verification: /download/jaco-lite.zip and its .sha256 both returned HTTP 200. ZIP length 16910583 bytes; calculated SHA-256 681e9fa9834826b7a27c55d389223f4f308426e2042cec39211371d19788ae1e matched the published checksum. This verifies transport integrity, not installation on a phone/laptop or a signature from a separate trust authority.

Remaining acceptance: physical device pairing, signed release provenance, external-client autonomous mission receipts and sustained operation. A successful inventory read does not establish deployment permission or mission execution.
