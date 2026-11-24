# JACO Cloud: Render customer control, Cloudflare private operator control

Decision: 2026-11-21. The operator explicitly chose Render for the **customer
cloud** and kept their already-working **private control** on Cloudflare.
This ADR corrects the older Cloudflare Durable Object customer design. It
does not claim Render has been deployed or authorized for production changes.

## One agent, one customer Relay, two *different* purposes

- **Private operator channel (existing): Cloudflare.** Keep the current
  operator-owned private control endpoint, authentication, tunnels, and
  rollback working. Do not import the operator's private account or tunnel
  into customer setup. This is not the customer SaaS Relay.
- **JACO Cloud (target): Render.** Own customer-facing web service, Google
  account identity and ChatGPT OAuth delegation, device registration,
  installation coordination, one account/device-scoped Relay and its
  durable event/request records. Server returns scoped statuses and
  verified receipts from the user's paired Aura; it does not run Aura.
- **Installed host (canonical):** one Aura Runtime on the user's computer.
  Existing Sentinel provides lifecycle supervision and can receive start
  instructions once transport ownership migrates out of the stopped Core.
  Android is a control client by default, not a second Aura runtime.
- **ChatGPT:** user-authorized plugin/MCP tools for initiating missions.
  Automatic reverse invocation requires an actually supported ChatGPT
  subscription/event mechanism; a queued event is not delivery.

Only one **customer** Relay may dispatch a given customer request. The
private Cloudflare control is a separate, explicitly operator-owned path
and must not race the Render customer Relay for mission ownership.
A host with both connections must deterministically arbitrate admission
through a single local mission/deduplication ledger.

## Existing implementation inventory

- `site/jacocode.com/link.mjs`, `link-protocol.mjs`,
  `site/jacocode.com/wrangler.jsonc`: existing Cloudflare
  Worker/Durable Object implementation of account rooms, pairing,
  bounded RPC. **Reference implementation, not the target Render deployment.**
- `runtime/src/server/connected/jacoLinkHost.mjs`: existing outbound host
  client. Preserve the account/device pairing protocol when migrating.
- `runtime/bin/sentinel-windows.mjs`: existing local lifecycle owner.
- `agents/lib/git-control-receipts.mjs`: legacy Git transport with
  non-authoritative status; not a substitute for Render and never a
  consumer installation channel.
- `skills/browser-authorized-action/SKILL.md`: existing authorized
  browser skill for manual handoff. Do not create a second browser Skill.
- PR #355 is independently finishing Aura consolidation. Never duplicate
  or overwrite its owners; integrate after successful main verification.
- PR #357 holds isolated reliability/call-inbox fixes and compatibility
  behavior; it is **not** a deployed Render customer service.

## Migration to Render without making two SaaS products

1. Inventory any existing Render service/database and select the appropriate
   workspace *after operator confirmation*. Reuse an existing JACO customer
   service if it already owns the account/Relay responsibility. Do not
   create a new service automatically or import unverified secrets.
2. Adapt the existing Link protocol to a Render HTTPS/WSS handler and
   durable transactional persistence (for example a **single** existing
   Postgres database with account/device isolation and event uniqueness).
   No separate Render agent runtime or additional relay process. Preserve
   old wire-compatible message formats only while migrating registered hosts.
3. Replace Cloudflare-specific Durable Object room storage with the one
   chosen Render transactional owner. Avoid an in-memory queue as the sole
   source of truth; enforce uniqueness for
   `(account_id, device_id, command_id)` and
   `(account_id, event_id)`. Fencing tokens/generation IDs ensure only the
   currently paired host can acknowledge a mission.
4. Integrate verified Google subject, dedicated ChatGPT OAuth/MCP scopes,
   grant revocation, consent, CSRF and per-device routing. No public
   bearer-less command forwarding or customer use of an operator token.
5. Migrate the one host connection's supervisor ownership to Sentinel for
   Core-off cold start; never open competing cloud sockets for the same
   installed device/mission without explicit migration fencing.
6. Test installation through the existing customer installer and linked
   Android PWA, **not** through a new install agent. User/OS approval remains
   required. Verify actual runtime READY and a harmless mission receipt.
7. Require real two-account tests: revocation, offline host, resumed
   request, concurrent duplicated write, cross-tenant denial, crash
   recovery, callback pending and observed completion, with no 2nd agent.
8. **Only after** Render is live and independently verified for customer
   onboarding, retire the customer Cloudflare DO deployment, if any; do
   not retire the private operator Cloudflare channel.

## Delivery truth

Current Cloudflare Link code is a technical reference. The Render service,
its OAuth MCP endpoint, durable Relay and ChatGPT callback subscription are
**not proven deployed** by this ADR. No guarantee that consumer ChatGPT
mobile chats can be woken from a browser Skill or webhook. OpenAI's supported
plugin/Events surfaces and authorization apply independently of cloud host.
