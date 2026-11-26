# MCP research, implementation and verification workstreams

Owner: integration coordinator; no second runtime, no parallel edits to the same module. This is a work plan and evidence ledger, not proof of running worker processes.

## A — Research (issue #408)
Observed 2026-11-26:
- MCP revision 2026-07-28 introduces stateless requests, optional server/discover, per-request client metadata and method/name routing headers. Older initialize/session transport remains a compatibility concern. JACO currently supports only 2025-03-26 and 2025-06-18 in HttpMcpClient.
- Authorization discovery uses protected-resource metadata plus OAuth/OIDC issuer metadata. Prefer registered client or client ID metadata documents; DCR is a backwards-compatible option, not the default. Pin issuer/resource, PKCE S256, state and callback; do not borrow vendor client IDs.
- GitHub documents OAuth and PAT for remote MCP. Render documents OAuth for supported clients and scoped Bearer API keys; JACO's client registration and live OAuth access are not yet established.
- The official TypeScript SDK v2 supports OAuth client-provider storage and issuer-bound registrations; compare its supported versions, license, dependency cost and transport behavior with adapting the existing host before selecting a dependency. Do not write a second MCP host.

Sources:
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://ts.sdk.modelcontextprotocol.io/v2/clients/oauth
- https://render.com/docs/mcp-server
- https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/extend-copilot-with-tools-and-context/set-up-the-github-mcp-server

Research question: can a single canonical host support the current and legacy MCP versions and issuer-bound OAuth without increasing exposed privileges? Compare SDK adapter versus incremental transport changes. Falsifiers: regression in existing 2025 servers, incorrect issuer or token audience, unapproved scopes, duplicate dispatched calls, or unauthenticated status reported as verified. Deliver reviewed protocol and provider contracts before implementation. Budget first experiment: two provider contracts, controlled HTTP fixtures, no paid calls or real credentials.

## B — Build (issue #409)
PR #405: complete account onboarding and credential rotation. Prior SHA b060ce09 had one failing browser job; the disabled replace button was reproduced in CI logs, and the asynchronous native toggle was replaced by explicit controlled state in a607566, with test update 6710679. Fresh CI required. Next: separate OpenSpec change for MCP protocol compatibility and OAuth client adapter using the research contract. Single host and existing secret store, no new financial rights.

## C — Verification (issue #410)
Gate each provider independently: pinned endpoint, safe credential storage, read call, policy-bound Aura dispatch, restart, expiry/rotation, revocation, negative authorization, desktop/mobile. Record exact SHA, CI evidence, actual account and runtime evidence without exposing credentials. Fixtures are not live certification. No merge before affected CI and review. Baseline remains 3/10; no upgraded score based on source changes alone.

Handoff: A -> reviewed provider contract -> B -> exact candidate SHA -> C -> accepted evidence or concrete defect back to A/B.
