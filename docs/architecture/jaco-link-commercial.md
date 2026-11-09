# JACO Link — commercial architecture and launch gate (2026-11-09)

## Product contract
**One primary agent, Aura, per Windows runtime. One JACO-operated SaaS control plane. No customer-managed tunnels.** Customer installs Windows JACO, chooses Devices > JACO Link, signs in with the existing jacocode.com Google account and authorizes that computer. The Windows host connects OUTBOUND over WSS. Android signs into the same account at https://jacocode.com/link/remote.html and uses the same local Aura, mission IDs, Gameboard, memory and approvals.

No Android Termux/runtime, customer Cloudflare/DNS setup, open firewall port, cloud inference or mirrored memory.

## Research and architecture decision
- **Rejected:** per-customer Cloudflare Tunnel + Access: high onboarding friction and low supportability.
- **Deferred:** direct WebRTC mesh/TURN: extra signaling/NAT support and operational complexity; useful for optional end-to-end encrypted data transfer later.
- **Alternative:** general Node.js/WebSocket relay with database and HA: portable but requires a cluster/load-balancing/store on day one.
- **Selected for v1:** Cloudflare Durable Objects, with isolated room per verified Google subject, SQLite-backed pairing/device metadata and hibernating WebSockets. Each customer uses the SAME JACO-operated service; no customer needs a Cloudflare account. Documentation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/ and https://developers.cloudflare.com/durable-objects/platform/pricing/ . Billing is usage-dependent, not a known flat SEK-per-customer figure.

## Implemented code
- site/jacocode.com/auth.mjs — reuses the existing signed Google session; allowlisted post-login return to Link approval or Remote page.
- site/jacocode.com/link.mjs — account-scoped rooms, one-time 10-minute pairing, signed host token, persistent revocation, websocket relaying with bounded payloads.
- site/jacocode.com/link-protocol.mjs — strict allowlist for Aura chat, start-goal, plan, memory, mission steering/stopping, and explicit operator approval calls. No arbitrary local file, shell, MCP or Git API forwarding.
- site/jacocode.com/wrangler.jsonc — two new SQLite Durable Object bindings/migration. LINK_ENABLED defaults to 0 so a normal site deployment cannot silently expose the new service.
- runtime/src/server/connected/jacoLinkHost.mjs — outbound-only Windows connector, reconnection, local protected credential storage, timeout/unknown outcome semantics.
- runtime/server.ts and runtime/src/components/DevicesView.tsx — local-only pairing and simple JACO Link onboarding.
- site/jacocode.com/public/link — mobile PWA with Aura chat, Gameboard, local-memory inspector, mission control, explicit approvals, logout via Google and revocation controls.
- tests/nova/jaco-link-saas.test.mjs — pair token and replay, tenant isolation, RPC allowlist, host request behavior and app packaging.

## Operator authority, tenant separation and privacy
- Every phone WebSocket is bound to the server-verified existing Google session (subject). Every Windows host token includes account, device, expiry and dedicated audience and is HMAC-signed by the JACO service.
- A separate random secret authenticates the unpaired Windows device poll; it is never delivered to the mobile UI. Revocation permanently invalidates that device ID in its account room.
- The cloud never executes tools or owns missions. Only a tightly bounded set of local Aura endpoints is available to an authorized customer phone. Shell/file/MCP/model credentials stay local.
- A disconnected request with possible side effects is reported OUTCOME_UNKNOWN. The phone must not retry it automatically.
- TLS protects messages in transit; the relay can technically access the payload while forwarding. This version is NOT end-to-end encrypted and must not be described as zero-knowledge. Local Continuum and models are not moved to Cloudflare.
- Host credential uses a local JSON file with restrictive mode where supported. Windows DPAPI/credential-vault protection and hardening against malicious local processes remain open before general availability.
- Abuse protection, per-account quotas, device deletion, retention, GDPR/data-region assessment, privacy policy, subscription entitlement and independent security review remain release requirements. No production-ready compliance claim is made.

## Deployment: JACO operator only, customers have zero infrastructure tasks
1. CI must pass TypeScript, production build, site asset tests, multi-tenant tests and Windows install smoke tests.
2. Provision the site Worker secret LINK_SIGNING_KEY with a high-entropy random value. Never commit it. Existing SESSION_SECRET is reused solely for website identity. Verify the new DO migration jaco-link-v1.
3. Publish the JACO site ONLY through the existing JACO Lite release workflow; it restores download ZIPs/installers before deployment. Direct site deploy from an incomplete public/ directory can remove current downloads.
4. Deploy first with LINK_ENABLED=0, then verify existing website, Google OAuth and downloads. Do not enable customer traffic without explicit operator release approval and acceptance receipts.
5. Enable LINK_ENABLED=1 for a small explicitly approved beta. No customer must configure a cloud account. Support rollback via LINK_ENABLED=0 and preserve revocation records.
6. Measure Cloudflare requests, duration, storage, 95th percentile pairing/reconnect, error rates, cloud cost per active customer and support interventions. Set real budgets and alerts before public launch.

## Acceptance matrix
- Two distinct Google accounts + two Windows PCs + two Android phones: account A never sees or controls B, including after reconnect. SOURCE TEST only; real cloud+device acceptance UNKNOWN.
- Windows behind NAT/CGNAT: outbound WSS without opening inbound ports. Real connection UNKNOWN.
- Pair code expired, replayed, guessed; host token expired or revoked: all denied with receipts. Unit tests available; real environment UNKNOWN.
- Mobile keyboard at 320/390/430 CSS px, PWA installation and Chrome session recovery: physical Android acceptance UNKNOWN.
- Start mission, steer, stop, approve, inspect memory: same mission ID/evidence in phone and local Windows, with no duplicate writes. End-to-end acceptance UNKNOWN.
- Cost, uptime, data deletion, emergency revoke, abuse handling, backup and recovery: NOT YET VERIFIED.

## Business packaging
The goal is an included JACO account benefit, not a tunnel sold to each customer. Subscription tiers, Stripe billing and paid quotas must use authenticated JACO account entitlement and verified operating costs; merely logging in with Google is not payment entitlement. Do not claim an SLA or advertise a finished commercial multi-tenant service before acceptance and security review.
