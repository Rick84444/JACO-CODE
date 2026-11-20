# JACO Control: implementation research and Codex-parity decision record
Date: 2026-11-21
Status: source-backed design, not a deployed plugin or a completed device test.
Owner: canonical JACO Link + canonical Aura Runtime. No second primary agent.

## Research objective
Make a customer's **ordinary ChatGPT conversation on mobile and desktop** an
authenticated, bounded, verifiable control surface for **that customer's** one
paired Aura runtime. Support activation, goal creation, monitoring, steering,
stopping, and requests from Aura for human/ChatGPT follow-up. Preserve
Continuum, Gameboard, Mission Bus, Nova execution, security policy, approvals
and receipts. Never treat static code, a Git ACK, an online socket, or the
model's answer as proof of execution.

### Null hypotheses and falsifiers
- H0: A second relay/executor is necessary. Falsifier: JACO Link + Core
  supports the tool contract, account isolation and verified execution without
  a second mission store or agent.
- H0: A private MCP tunnel is sufficient for a customer-facing mobile
  product. Falsifier: public plugin publication requires stable public HTTPS
  MCP, not only a private/local tunnel.
- H0: ChatGPT can automatically be woken by a reverse relay event. Falsifier:
  no capable connected client or separately authorized background delivery
  acknowledges the call. An enqueued event MUST remain pending.
- H0: A green unit test proves end-to-end. Falsifier: login, revocation,
  disconnection, device recovery, real model tool call or verified mission
  receipt fails on a second independently authenticated account.

## Primary sources (read 2026-11-21)

1. OpenAI public plugin MCP requirements:
   https://developers.openai.com/plugins/build/mcp-server
   Stable public HTTPS /mcp, Streamable HTTP, real tool schemas and privacy.
   A Secure MCP Tunnel is for private testing; not public-plugin submission.
2. OpenAI plugin authentication:
   https://developers.openai.com/plugins/build/auth
   OAuth 2.1; RFC 9728 protected resource; RFC 8414 AS metadata; RFC 8707
   resource/audience; PKCE S256; CIMD preferred where supported; DCR fallback;
   correct redirect/issuer; optional OpenAI mTLS client authentication.
   User consent is additional to existing website Google sign-in.
3. MCP authorization 2026-07-28:
   https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx
   Distinct authorization vs resource servers, 401 vs 403, exact audience.
4. OpenAI plugin policies/review:
   https://developers.openai.com/plugins/plugin-guidelines
   https://developers.openai.com/plugins/deploy/app-review
   Every exposed tool must have a real bounded purpose; avoid one hidden
   generic executor, secret extraction and unreviewable side effects. Requires
   tested demo account, privacy policy, customer support, developer verification
   and actual mobile/desktop compatibility. No cross-service OAuth token reuse.
5. Cloudflare *existing* library (MIT):
   https://github.com/cloudflare/workers-oauth-provider
   Supports OAuth 2.1 and MCP 2026 auth discovery, Client ID Metadata Documents,
   Google as upstream sign-in, scoped grants and revocation. **Reuse instead of
   writing a new JACO OAuth implementation.** Check current exact package
   version/license before pinning.
6. Cloudflare SDK v2 stateless MCP handler:
   https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
   `createMcpHandler` + `OAuthResourceServer` on the existing
   jacocode.com Worker. Keep handler stateless; JACO Link Durable Objects
   continue owning transport and device pairing. Validate Origin/Host and
   bearer scopes on **every** request. Do not copy an outdated v1 import shape.
7. OpenAI Codex App Server:
   https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
   Thread resume, command/approval events, replay, explicit state inspection.
   **Copy the behavior, not the engine:** JACO already owns mission IDs,
   durable execution and receipts; map these to narrowly scoped MCP tools.
8. OpenHands runtime:
   https://github.com/OpenHands/docs/blob/main/openhands/usage/architecture/runtime.mdx
   Separates action execution, observations, event stream, sandbox and resource
   isolation. JACO should verify its existing code/test sandbox; do not install
   a second OpenHands runtime.
9. Hugging Face smolagents:
   https://huggingface.co/docs/smolagents/index
   https://huggingface.co/docs/smolagents/en/reference/agents
   Model-agnostic CodeAgent/ToolCallingAgent, max steps, callbacks, planning,
   managed workers, structured tool results. **Reuse design/evaluation patterns
   only:** preserve JACO's own SEER/Planner, provider registry and execution
   graph; do not add a duplicate Python agent stack.
10. HF Chat UI:
    https://huggingface.co/docs/chat-ui/main/index
    Illustrates OpenAI-compatible model endpoints and MCP interoperability,
    including llama.cpp. JACO already has this concept; no replacement UI.
11. Community OAuth implementation notes (anecdotal, not normative):
    https://www.reddit.com/r/mcp/comments/1w1hmo8/shipped_oauth_on_our_mcp_server_so_claudeai_and/
    Common failure modes: missing metadata, incorrect 401 challenge, redirect
    mismatch and accidental connector-token reuse. One author's DCR claim is
    not authoritative for 2026 CIMD-capable clients; prefer current OpenAI docs.
12. Small-local-model agent harness notes (50 task/harness runs, anecdotal):
    https://www.reddit.com/r/LocalLLaMA/comments/1xc0dc2/what_actually_breaks_agents_on_a_4b_model_notes/
    Tool call parsing wasn't always the blocker; exact edits, repeated failures,
    hidden test overfit, numeric errors and long prompts were prominent. Test
    JACO's retry strategy, concise tool schemas, independent tests and memory.
13. TypeScript MCP SDK:
    https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md
    The resource server validates tokens and advertises discovery; it is not
    itself the issuing authorization server.
14. ChatGPT plugin distribution:
    https://developers.openai.com/plugins/quickstart
    https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
    Private development connection is not proof of availability in the
    standard ChatGPT Android app. Public plugin review, account settings and
    mobile end-to-end testing are required.

## Existing JACO implementation search (main, November 2026)
- Account authentication: `site/jacocode.com/auth.mjs` uses Google's immutable
  `sub` plus signed cookie. This cookie is not a ChatGPT
  bearer grant.
- One customer transport: `site/jacocode.com/link.mjs` Durable
  Object room per Google `sub`, device pairing and revocation.
- One RPC allowlist: `site/jacocode.com/link-protocol.mjs` with
  permitted `GET /api/aura/plan`,
  `POST /api/aura/workbench/start-goal`,
  `POST /api/aura/workbench/missions/:id/{steer,cancel}`.
- One local owner: `runtime/src/server/connected/jacoLinkHost.mjs`,
  outbound WSS; **today it is embedded in Core** and cannot receive requests
  when Core is off.
- One executor: `runtime/server.ts` Core + Continuum +
  SEER/Planner + Mission Bus + Nova + permission/verification/evidence.
- Private diagnostic MCP tools:
  `runtime/gateway/src/private-aura-tools.mjs`. Useful
  *contract references*, not a second customer transport.
- Local/bootstrap Sentinel:
  `runtime/bin/sentinel-windows.mjs` and
  `runtime/gateway/src/github-bootstrap-control.mjs`.
  Git transport must be retired only after the single JACO Link receiver
  has independently proven startup while Core is off.
- Deprecated alternatives:
  `gateway/src/chatgpt-nova-gateway.mjs`,
  `gateway/src/workplace/chatgpt-github-relay.mjs`,
  `agents/lib/github-control-inbox.mjs`. They are NOT
  per-customer production providers. See canonical relay ADR.

## Decision matrix
Criterion: reuse of current product | no second runtime | user onboarding |
independent security review | recovery/readiness.

| Approach | Decision | Reason |
| --- | --- | --- |
| GitHub issues/ref polling as customer ChatGPT relay | Reject | Public/owner-specific, delayed, lacks private tenant OAuth and device routing |
| Per-customer Cloudflare Tunnel | Reject for public v1 | Operator friction; additional customer infrastructure and multiple unmanaged endpoints |
| Custom OAuth server written by JACO | Reject | Avoid duplicate/security-critical protocol implementation |
| Fork smolagents/OpenHands/Codex as a new JACO agent | Reject | Creates a second agent, mission store or planner |
| Existing JACO Link + Cloudflare Workers OAuth Provider + stateless MCP v2 handler | **Select** | Reuses one account room, one host transport and existing Aura; OAuth, tools, and user consent can be independently audited |
| Existing local/private MCP via secure tunnel | Keep as developer diagnostics | Can validate tools before public release; not a public mobile product |

## One product architecture

```text
Customer's normal ChatGPT mobile/desktop conversation
  → published "JACO Control" MCP plugin (user-installed)
  → JACO OAuth 2.1 (Cloudflare Workers OAuth Provider)
      ↳ customer logs in using existing jacocode.com Google session
      ↳ explicit consent + exact scopes + chosen paired device
  → stateless HTTPS MCP endpoint /mcp on jacocode.com
  → account:<verified Google sub> JACO Link Durable Object
  → exactly one previously paired JACO Link host connection
  → Sentinel lifecycle owner (needed for Core cold start)
  → canonical Aura Core → SEER/Gameboard → Mission Bus → Nova/tools
  → bounded verified receipts/status → same chat on next tool call
```

The cloud does NOT run a second Aura, cannot read raw passwords/API secrets,
and never accepts caller-supplied Google sub or target device as routing
authority. The MCP handler uses server-authenticated identity only.

## Exact initial tools (not a generic shell/MCP proxy)

| Public MCP tool | Scope | Existing JACO behavior | Semantics |
| --- | --- | --- | --- |
| `jaco_devices` | devices.read | JACO Link account host inventory | Device ID + online, nothing about other accounts |
| `jaco_runtime_status` | aura.status.read | Sentinel host status / Core plan | Freshness and readiness; OFFLINE if none |
| `jaco_start_runtime` | aura.lifecycle.activate | existing Sentinel activation | Idempotent, scoped to one device, actual new Core READY receipt |
| `jaco_submit_goal` | aura.goal.submit | Core's existing Aura start-goal | ACCEPTED, not finished; never auto-retry unknown mutation |
| `jaco_mission_status` | aura.status.read | existing mission bus/receipts | Exact mission ID, status, verified evidence pointers |
| `jaco_steer_mission` | aura.mission.steer | existing mission steer route | Planning-boundary request, not immediate tool interruption |
| `jaco_cancel_mission` | aura.mission.cancel | existing mission cancel | STOP_REQUESTED, wait for stop receipt |
| `jaco_knowledge_search` | aura.knowledge.read | bounded Continuum projection | Explicit verification status, never raw vault secrets |
| `jaco_call_inbox` | aura.calls.read | *future* durable CALL_REQUESTED event | Pending until actually delivered and acknowledged |

Do not expose raw shell, CDP, arbitrary URL fetch, payment, credential
retrieval, arbitrary tool names or approval bypass as a single "generic
executor". Existing Aura handles internal allowed tools within a scoped
mission. Every public tool has its own schema, read/write annotations,
permission and test. Authentication scopes are **necessary, not sufficient**:
Core policy and approval checks remain authoritative.

## Required implementation order

P0. Merge the non-regressive duplicate Relay cleanup after current CI.
    Pin exactly one customer transport and disable legacy default launches.
P1. Use existing jacocode.com Worker and identity. Pin upstream OAuth Provider
    version to a reproducible release, wire an OAuth-consent screen for scoped
    *second-stage* ChatGPT permission. Validate immutable sub, device,
    revocation, token audience, PKCE, CIMD, redirects and expiry.
P2. Mount stateless MCP v2 tools to the existing Worker. **No separate app
    service or reimplemented login.** Expose read-only tools first. Demo
    account and contract tests must be available without a production user's
    information.
P3. Add authenticated internal HTTP → account room → selected host RPC for
    MCP. Do not emulate a phone WebSocket or copy per-account session cookies.
    Use bounded request IDs, TTL, timeout, one receiver, no cross-user routing,
    and OUTCOME_UNKNOWN on write interruption.
P4. Move single JACO Link host connection ownership from Core to existing
    Sentinel lifecycle. No two host sockets for one device. Observe Core off,
    submit start intent, verify Core's new process identity and Workplace+Nova.
P5. Add goal/status/steer/cancel and evidence; verify long-running missions
    survive chat closure, tool timeout, model change and Core restart.
P6. Add reverse-call inbox using a durable Continuum event and scoped JACO
    Link delivery. This is not "wake cloud ChatGPT" unless an actual supported
    client or user-approved automation acknowledges it.
P7. Apply through the public plugin review process; real test with separate
    accounts and real ChatGPT mobile/desktop. Enable phased rollout only
    after independent device/customer tests and deletion/revocation checks.
P8. Once P1–P7 have target-host receipts, remove old Git/HTTP launcher flags,
    migrate active callers, move historical source to legacy and delete
    duplicated service instances.

## Critical failure matrix
- Auth: user A token tries to name B's sub/device; deny before room dispatch.
- OAuth: missing metadata, expired token, wrong audience, reused code, bad
  PKCE, arbitrary redirect, revoked grant; deny with proper 401/403.
- Device: paired PC offline, Core stopped, Sentinel stopped, revoked paired
  device, two hosts in one account; never dispatch to ambiguous recipient.
- Runtime: Core returning 401, tools missing, planner unresponsive, ledger
  locked, mission paused, manual operator approval pending; honest blockers.
- Transport: disconnect during POST; report OUTCOME_UNKNOWN, query durable
  outcome by same request/mission ID; never submit twice.
- Safety: prompt injection in file/web content cannot change OAuth scope,
  approve payments or widen code workspace; tool results are data.
- Evidence: admission receipt is not execution; COMPLETED requires real
  executed tool receipt, tests and independent verification.
- Reverse call: event queued but no actual client subscriber → PENDING,
  never "ChatGPT responded".
- 4B model: invalid edit retry cannot loop indefinitely; switch strategy
  after repeated identical failures; use deterministic code/test oracles and
  independent hidden fixtures.
- Efficiency: one model server on resource-constrained phone; short focused
  context; no unnecessary duplicate provider/agent service.
- Delivery: plugin available on web but not mobile, or app tool disabled in
  user's plan; truthfully report client capability and don't claim it works.

## Codex-parity measurable acceptance
1. Zero direct human token pastes after user signs in and authorizes app.
2. Two distinct Google subs and two ChatGPT sessions: 0 cross-account reads
   and 0 cross-account mutations across 100 negative isolation scenarios.
3. Core OFF + Sentinel ON: authenticated start returns true fresh readiness
   receipt from same installed Aura, with no second runtime.
4. 10 scoped coding tasks (5 randomized held-out copies each): measured
   completed receipts, test exits, runtime cost, retries and tokens. Do not
   equate model output with a pass.
5. 10 network cut points around mission admission, steer and cancel:
   no uncontrolled duplicated write; ambiguous outcomes reported as unknown.
6. Chat interrupted/reopened on Android: same account/mission ID persists
   with accurate Gameboard and evidence.
7. Approval required while user offline: remains pending or denied; never
   silently approved by cloud routing.
8. Revocation during active session blocks *new* calls immediately, with
   documented behavior for already accepted local missions.
9. External security review of OAuth, DoS, secrets, Durable Objects routing,
   outbound host credentials, GDPR, data deletion and device reset.
10. Public plugin tool review + real mobile invocation confirmed.

## Unresolved before "full solution"
- Production OAuth grant store, consent UI and verified client metadata.
- Hosted MCP server + per-account HTTP→Durable Object→host RPC.
- Single JACO Link host transport moved into Sentinel for cold start.
- Callback support and true "summon ChatGPT" client delivery.
- Independent tests, staged Cloudflare deploy, OpenAI public-plugin review
  and physical ChatGPT mobile acceptance.
- The existing local Core 0.23.1 + 107 tool catalog is not evidence that
  the mobile ChatGPT app currently has these tools.

## Research quality
Source observations are documentation and community posts, **not** a lab
benchmark. The Reddit 4B comparison used 10 harnesses × 5 tasks on one
hardware/model and should be treated as an exploratory warning, not a
generalizable ranking. We have not executed a real OAuth token exchange,
GitHub CI on this full research revision, the target Windows/Android hosts,
or an authenticated cross-account ChatGPT MCP tool call.
