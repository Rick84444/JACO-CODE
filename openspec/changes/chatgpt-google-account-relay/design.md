# Design: per-account remote MCP adapter to canonical Aura

```text
Customer's ChatGPT mobile or desktop (same custom MCP plugin)
          |
      HTTPS/OAuth 2.1
          |
  jacocode.com/mcp        <- shared SaaS MCP endpoint (NOT GitHub)
          |
   validate bearer audience/resource, client, expiry, scope
          |
  Google-authenticated JACO grant -> tenant = Google OIDC sub
          |
  select previously paired / non-revoked JACO Link device
          |
  account:<sub> Durable Object room
          |
  existing outbound host WSS, no inbound PC port
          |
  customer's canonical Aura Runtime -> SEER -> Mission Bus -> Nova
```

## Identity and authorization boundaries
- JACO website Google sign-in establishes the user's JACO account identity.
  The Google ID token is only for the website's OAuth callback; **never**
  forward Google's access/ID token to ChatGPT or Aura.
- ChatGPT connection is a second OAuth 2.1 delegation, not proof of a Google
  account simply by seeing a matching email. The user must initiate it from
  their ChatGPT account and explicitly consent to selected scopes and device.
- Authorization Code + PKCE S256, issuer/authorization/token endpoints,
  authorization server metadata (RFC 8414), protected resource metadata
  (RFC 9728), resource indicator (RFC 8707) and client registration/client-ID
  metadata as supported by current ChatGPT plugin auth contract.
- Prefer ChatGPT Client ID Metadata Documents (CIMD) if supported:
  `client_id_metadata_document_supported: true`, validate the declared
  client metadata URL and **exact** registered redirect URLs. Fallback to
  DCR only as needed. Never accept arbitrary client-declared callback URLs.
- Advertise `authorization_response_iss_parameter_supported: true` and
  include the exact issuer `iss` in successful and error authorization
  responses (RFC 9207) to prevent authorization-server mix-up.
- For unauthorized MCP requests, return a standards-compliant `401`
  with a `WWW-Authenticate` challenge and protected-resource metadata.
  Accept access tokens only for the exact JACO MCP resource URL and
  granted scope; authentication must never be skipped because the request
  happens to arrive from a Google-signed-in web browser.
- Follow current ChatGPT OAuth requirements for token endpoint auth methods,
  `resource` propagation and approved PKCE S256 verifier handling. User
  consent (scope + device) is separate from Google sign-in.
- Validate explicit allowlisted client redirect URIs, issuer, audience,
  `resource`, `state`, code verifier, one-time code, expiry and scope before
  issuing a grant. Bind grants to stable `sub`, chosen `deviceId`, client
  registration identity and token IDs. Never accept `sub` or `deviceId`
  as an untrusted request parameter to choose an unrelated account.
- Rotate short-lived tokens and revoke grants independently of revoking a
  device or Google session. Never put OAuth bearer in URL/query, browser local
  storage, public Git, telemetry or plain-text logs.
- No `email`-as-tenant, global agent ID, default Rick84444 repository,
  global connected flag, shared ChatGPT conversation or per-customer Cloudflare
  configuration.

## MCP and dispatch
- HTTPS streamable HTTP MCP uses account-scoped token validation for every
  initialize/tools/list/tools/call request; no anonymous control tools.
- Initial scopes: `aura.status.read`, `aura.knowledge.read` (opt-in).
  `aura.goal.submit`, `aura.mission.steer` are separate explicit
  permissions only after read-only connection acceptance.
- Use a strict per-tool allowlist, bounded input, and existing Aura policy.
  No arbitrary shell, credential export, direct CDP, approvals, purchasing,
  deployments or unbounded model fanout.
- DO routes requests only to the selected online device within the verified
  user's room; never fan out to other tenants/devices. Core's private
  credentials stay on device; JACO Link host signs/validates local actions.
- Non-idempotent submission gets a durable request ID; loss after dispatch
  returns `OUTCOME_UNKNOWN` and must be reconciled by the same mission ID,
  never automatically resubmitted.
- API/agent requests report `NOT_CONNECTED`, `OFFLINE`,
  `AUTH_REQUIRED`, `REVOKED`, `PERMISSION_DENIED`,
  `ACCEPTED_NOT_VERIFIED` or verified receipts. Never infer success from
  model text, websocket open state or a Git branch.

## Host and SaaS
- Reuse JACO Link device-pairing UX, origin/CSRF controls, revocation and
  account-isolated Durable Object persistence. Introduce a separate
  per-account OAuth grant store with TTL, replay protection and quotas.
- Cloud is a transport/authorization plane; it does not run a second Aura.
- Add a clearly named *Connect ChatGPT* / *Disconnect ChatGPT* user flow
  only after real OAuth endpoints, hosted MCP transport and independent
  acceptance. Connecting is always user-initiated.
- Feature flags default OFF; stage through controlled Cloudflare deploy and
  independent security review; do not deploy via raw Worker publish that
  overwrites the JACO download artifacts.

## Mobile conversation acceptance

- The **same OAuth JACO app and OAuth grant** must be discoverable from an
  eligible customer's ChatGPT mobile session and desktop session, subject to
  the current ChatGPT client capabilities. Never equate JACO PWA login with
  ChatGPT app connection or an unsupported account feature.
- A user utterance in a ChatGPT mobile chat (for example, “Aura, inspect
  my JACO runtime and report failures”) calls the JACO MCP action through
  the account-scoped JACO Link transport, not instructions to paste CLI
  snippets. Return an actual `goalId` or `missionId`, then continue with
  status and verified receipts in the same ChatGPT conversation.
- The ChatGPT conversation can end while Aura continues executing. Future
  turns can reconnect to the same mission by scoped identity and durable ID;
  the JACO service stores no global mutable “current ChatGPT user”.
- “Operate phone from ChatGPT” is not automatically equivalent to
  “operate the phone's Android OS”. Additional mobile-device integration
  must be explicitly paired, permission-scoped, auditable and not rely
  on a second Android Aura runtime.
