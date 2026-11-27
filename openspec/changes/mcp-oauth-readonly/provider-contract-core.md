# OAuth provider contract core — stage 1

Base: PR #412 (Linear read-only pilot). This is a stacked change, not a second MCP host.
The existing Linear entrypoints now delegate to a provider-independent public-client
primitive. The loopback session accepts an internal reviewed engine. Existing Linear
credentials, host registration and UI remain unchanged.

## Trust boundary
Provider contracts are trusted source code, not catalog/registry/user/agent input.
Discovery must match the pinned issuer, resource and endpoints. HTTPS only, exact
read scope, S256, public DCR, issuer and state checks, single-use local callbacks.
No additional provider is enabled. The second provider is a synthetic test fixture
using .invalid domains; no actual network call is made to those domains.

## Next stages (not implemented here)
- SDK v2 compatibility spike against the canonical HTTP host and older transports.
- CIMD and pre-registered clients only after a reviewed callback/client identity
  exists and provider support is confirmed; no invented registration or fallback.
- Account-bound credential keys and crash-safe connection journal, followed by
  host/UI integration, remote callback, reauthorization and provider revocation.
- Reconcile PR #405 and #412, live account certification and Aura policy-bound
  dispatch. No expansion of write scopes or production readiness claim.

References:
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/auth.ts
- https://apps.extensions.modelcontextprotocol.io/api/documents/authorization.html
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadMcp.ts
- https://github.com/LibreChat-AI/LibreChat/tree/main/packages/api/src/mcp/oauth

Tests: existing OAuth pilot workflow already runs tests/nova/mcp-oauth-readonly.test.mjs
on Windows and Linux; synthetic provider, cross-engine isolation, pinned destinations
and injected session tests are added to that suite. CI and live certification are separate.
