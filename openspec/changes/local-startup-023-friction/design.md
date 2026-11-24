# Design

The startup controller remains `agents/lib/local-stack.mjs`. It already holds the startup lock and starts the canonical services. Introduce a small credential provisioning step **after acquiring the lock and before launching services**, reusing `scripts/setup.mjs::ensureGatewayToken`. This prevents two concurrent launchers from generating different credentials. The generated token is internal; the operator does not type or expose it.

Maintain existing API/MCP bearer verification and bind addresses. Provisioning does not authorize remote use or disable the emergency stop, port-ownership rules, durable ledger lock, approvals, or any policy. If `JACO_DATA_DIR` is configured, create the credential in the active data root and keep the same token in all child service environments.

The 0.21.0 text printed by `npm run jaco:start` comes from the root `package.json`, not `runtime/package.json`. Align root `package.json` and `package-lock.json` to 0.23.1; runtime remains 0.23.1. Avoid implying the runtime is finalized: `runtime/CURRENT_RELEASE.json` remains explicitly a release candidate.

## Security and validation
- Missing internal token: generate 32-byte cryptographically random credential once and propagate to all children.
- Existing valid credential: reuse.
- Explicit short/malformed configured credential: fail visibly without silently discarding it.
- Read-only commands do not mutate state.
- A running Aura from another checkout must not be duplicated; this change does not claim to fix every multi-install detection path. Operator must select the canonical installation before starting.

Verify syntax, existing setup and startup safety tests, package lock matching, and full affected CI. Hardware startup and live Windows remain separately unverified.
