# Proposal: ChatGPT ↔ JACO account-bound Relay

## Why
A JACO installation is not the developer's GitHub repository or any particular
ChatGPT conversation. A customer who signs in to jacocode.com with Google must be
able to authorize ChatGPT to access **that customer's** paired Aura runtime,
with zero customer-managed GitHub refs, gateway tokens, Cloudflare tunnels or
hardcoded personal account identifiers.

## Existing capabilities to reuse
- `site/jacocode.com/auth.mjs`: verified Google OpenID Connect identity
  `sub`, signed same-site JACO session, existing anti-CSRF state + PKCE.
- `site/jacocode.com/link.mjs`: account-isolated Durable Object rooms and
  revocable device pairing; host-initiated outbound WebSocket.
- `site/jacocode.com/link-protocol.mjs`: bounded explicit Aura operations.
- `runtime/gateway/src/private-aura-tools.mjs`: canonical Aura goal, status
  and steering contracts, without creating an alternate execution runtime.
- `gateway/src/workplace/chatgpt-github-relay.mjs`: legacy communications
  *developer transport only*, never the normal customer integration.

## Product interaction
1. Customer installs JACO and pairs their own PC/Aura through existing JACO Link.
2. Customer signs into jacocode.com with Google. The account is indexed by
   verified Google `sub`, never mutable email.
3. Customer connects the JACO MCP app within ChatGPT; ChatGPT initiates OAuth
   authorization to JACO, where the customer reviews account, exact paired
   device, capability scopes and revocation controls.
4. After explicit consent, the user's **ordinary ChatGPT conversation on
   Android/iOS or desktop** can invoke the same named JACO MCP tools: submit a
   goal to canonical Aura, query actual mission status and verified receipts,
   and steer an ongoing mission at the next planning boundary.
5. This works from the ChatGPT mobile app itself, not by telling the user to
   switch to the JACO PWA, Termux or a terminal command. The chat client must
   actually support the connected MCP app; no server-side relay code may
   falsely claim that current ChatGPT account/app access is provisioned.
6. Controlling Android OS/apps on the phone is a distinct device capability
   requiring a specifically paired Android companion, OS-granted permissions
   and proof of execution. The baseline mobile experience is to operate
   the user's paired canonical desktop Aura from ChatGPT on the phone. Neither JACO nor this assistant may silently link a
   ChatGPT account merely because Google sign-in succeeded.

## Non-goals
Do not auto-register arbitrary ChatGPT clients, expose local ports, publish
private conversations on GitHub, store user prompts in a common cloud log,
replicate Continuum, mint Google credentials for ChatGPT, or disable approvals.

## Release truth
The Google site identity and JACO Link substrate exist in source. A
multi-tenant ChatGPT OAuth authorization server, production MCP endpoint,
ChatGPT plugin registration, cloud deployment and real two-account acceptance
have **not** been implemented by this change. Do not advertise the connection
as ready until the acceptance matrix passes.

## Unified Relay requirement
The same account-bound JACO Link path carries ChatGPT-initiated status and
activation requests, operator goals, monitoring receipts and a bounded
CALL_REQUESTED event from Aura. No separate GitHub/ChatGPT/Nova relay server
or second root agent is introduced. A pre-Core bootstrap receiver is needed
for activation while Core is offline; reuse the existing Sentinel lifecycle,
not another JACO runtime.
