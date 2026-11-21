# Historic JACO relay compatibility

This directory records the retirement plan for overlapping remote control
transports. **Do not copy or move their source files here while production
startup scripts and live receipts still depend on them.**

Canonical customer routing is JACO Link:
`site/jacocode.com/link.mjs` and
`runtime/src/server/connected/jacoLinkHost.mjs`.

Previous implementations remain at their original paths as transitional
compatibility until source-callers, service ownership, remote receipts, real
customer OAuth MCP routing, and rollback are independently verified:

- `gateway/src/chatgpt-nova-gateway.mjs`: old Actions HTTP facade.
- `runtime/gateway/src/github-bootstrap-control.mjs`: Git bootstrap.
- `agents/lib/github-control-inbox.mjs`: Git mission inbox.
- `gateway/src/workplace/chatgpt-github-relay.mjs` and
  `chatgpt-git-ref.mjs`: Git Workspace messages.
- Private stdio MCP adapters: development/debugging only.

Every migrated implementation must be listed in
`docs/architecture/CANONICAL_RELAY_AND_DEDUPLICATION.md` with an observed
retirement receipt. Do not retain competing runtime generations "for safety".
