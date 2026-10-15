# External Model Connector Boundary

The local JACO runtime exposes the semantic relay on `/api/relay` and a local stdio MCP adapter in `tools/jaco-mcp-server.mjs`.

## Local MCP client

A compatible desktop/coding client can launch the MCP adapter locally. The adapter talks to `http://127.0.0.1:3000` and sends an `x-jaco-model-id`. If `GATEWAY_TOKEN` is configured, pass it as `JACO_GATEWAY_TOKEN` to the adapter.

The adapter can read identity/status, list Browser targets, attach to a tab, survey, begin Nova intent, set a Nova target lock, list operator mandates, execute semantic relay actions and read Browser receipts.

It cannot sign its own mandate.

## Hosted model

A hosted model cannot reach the PC's `127.0.0.1`. If an external connector/tunnel is used, terminate it at the JACO gateway and require `GATEWAY_TOKEN`. Expose only the semantic JACO routes required by the client.

Never publish or forward raw Chrome CDP port `9222`; an authenticated Chrome debugging endpoint can access logged-in browser state.
