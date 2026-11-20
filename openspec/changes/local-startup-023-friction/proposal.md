# Remove local startup credential friction and align JACO version labels

## Problem
The canonical JACO runtime is 0.23.1 while the root npm package and lockfile still identify as 0.21.0. In a fresh Windows checkout, invoking `npm run jaco:start` after `npm ci` fails with `GATEWAY_TOKEN_REQUIRED_MIN_24`, although `npm run setup` can generate a local random credential. The user should not configure this internal credential manually.

## Scope
- Align root package and root lock metadata with runtime version 0.23.1. Do not change release manifest's `RELEASE_CANDIDATE` or `canonical=false` claims.
- At canonical startup, transparently provision a cryptographically random local gateway credential only when entirely missing. Preserve existing credentials and preserve live-process/ledger/port protections.
- Keep authentication enforced on HTTP/MCP endpoints and retain explicit authorization for remote/cloud/financial operations.
- Add deterministic regression tests; no separate Aura runtime, key store or new tokenless HTTP bypass.

## Falsifiers
- A fresh checkout must be able to proceed past the token precheck without a manual credential while internal endpoints still require the generated credential.
- A configured short credential remains an explicit error, not silently overwritten.
- Read-only configuration/status/preflight must not generate credentials or launch processes.
- Existing validated credentials remain byte-identical.
