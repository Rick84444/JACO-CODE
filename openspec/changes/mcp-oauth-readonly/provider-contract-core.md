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

## Consolidation and upstream reuse decision (2026-11-27)

The three implementation/test files were transferred from #414 at 0a14f22 to
the #412 draft only after verifying that each original file's blob SHA was
unchanged on #412 since the common ancestor 32d3a5f. Keep #414 open until
the combined candidate has passed exact-head CI and security review. No
production merge or expanded authorization has been performed.

Upstream research:
- MCP TypeScript SDK v2: https://github.com/modelcontextprotocol/typescript-sdk
  and https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/oauth.md .
  Evaluate a pinned release against the existing canonical host. The SDK
  supports discovery, registration, redirect, token storage hooks, and protocol
  negotiation; the JACO vault, authority checks, and execution receipts remain
  authoritative. SDK license is Apache-2.0 for new contributions with existing
  MIT code; inspect release license and notices before incorporating code.
- GitHub local MCP: https://github.com/github/github-mcp-server/blob/main/docs/oauth-login.md .
  Official binaries support interactive account login without manually supplied
  keys, but currently keep their OAuth token only in memory. Evaluate lifecycle,
  read-only tool restrictions, signed release provenance, and out-of-band
  browser authorization before using the existing stdio host. Do not copy
  embedded app credentials or expose login URLs to the model. MIT license:
  https://github.com/github/github-mcp-server/blob/main/LICENSE .
  Remote MCP still needs a registered GitHub App or OAuth App:
  https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md .
  Existing GitHub CLI login is a separate, reusable Git path.
- Render supports browser OAuth: https://render.com/docs/mcp-server .
  Confirm the actual client registration mechanism, scopes, callback and
  account probe before enabling; do not reuse another client's identity.
- Google installed applications: https://developers.google.com/identity/protocols/oauth2/native-app .
  Use the official application registration, system browser and PKCE; Google
  sign-in alone does not grant authorization for individual Google APIs.
- MCP July 2026 revision: https://blog.modelcontextprotocol.io/posts/2026-07-28/ .
  Compare CIMD and stateless transport compatibility before replacing transport.

No external code or dependency has been incorporated in this consolidation.
The additional real providers, persistent cross-provider credential routing,
revocation, cloud callback and live account validation remain unimplemented.
Use the official provider SDK/binary where compatible; keep JACO-specific
mission policy, account verification and evidence outside the vendor adapter.
