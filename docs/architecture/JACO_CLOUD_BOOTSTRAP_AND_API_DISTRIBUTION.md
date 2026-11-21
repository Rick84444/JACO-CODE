# JACO Cloud bootstrap and API distribution (design and first delivery slice)

Status: **read-only install plan implemented**. OAuth MCP registration, full runtime deployment, remote install execution, and downloadable API adapter installation are NOT implemented or verified.

## Product goal

A customer writes in their usual ChatGPT conversation: “@JACO Control, install JACO on my computer, connect Aura, and enable read/write development.”

Architecture: ChatGPT (external reasoning/control client) → customer-authorized OAuth JACO Control MCP → existing jacocode.com Cloud control plane → per-account existing JACO Link room → one paired host → Sentinel lifecycle (when Core is down) → canonical Aura Runtime → mission graph, tools, verifier, Continuum.

A phone with ChatGPT is **only a remote client**. No Termux or phone AI runtime is necessary. Installing a new desktop host requires an explicit local installation step or a separately granted computer-control capability: an ordinary conversation cannot silently execute a first installer on an unpaired PC.

## Cloud installs the platform, local Aura owns work

JACO Cloud SHALL manage:
- product and API adapter catalog, platform-specific release selection, provenance, artifact digests, update channels and revocation;
- customer OAuth consent, account-to-device pairing, control scopes, install session states and progress receipts;
- signed distribution manifests and versioned artifacts (future: R2/release storage); immutable audit references, tenant quotas and rate limits;
- optional managed inference gateway chosen by user, with cost limits and separate credentials.

JACO Cloud SHALL NOT host a second Aura, decide its local policy, take unrestricted shell commands, store raw vault keys or own local mission state.

Local JACO SHALL manage:
- one Aura runtime and durable Continuum/missions;
- existing installer, provider registry, Skill engine, MCP registry, vault, tests and rollback;
- deployment of independently authorized connectors and packages with isolation and verified results.

## API/extension delivery contract (proposed, NOT implemented)

A cloud catalog entry MUST bind `id`, `kind`, `version`, `supportedPlatforms`, `artifactUrl`, `sha256`, `signature/provenance`, `entrypoint`, `declaredPermissions`, `credentialRequirements`, and `tests`. A verified local installer MUST enforce:
1. authenticated customer's explicit selection (or an existing scoped autonomous policy), approved publisher and exact catalog version;
2. immutable digest/signature, trusted download origin, size limit, dependency review and quarantine;
3. validation of declared MCP/model API, local sandboxing, no access to raw vault secrets, least privilege;
4. smoke test with negative controls; atomic registration into existing canonical MCP/provider registry, never a new tool registry;
5. durable receipt, revocation, rollback to the last known-good adapter, no silent re-execution on unknown outcomes.

Do not treat arbitrary external JavaScript, npm scripts or downloaded Skills as trusted just because the Cloud catalog lists them. Existing `agents/lib/skills.mjs` already installs restricted instruction Skills; extend existing canonical owners for future API adapters.

## Implemented endpoint: `GET /cloud/v1/install-plan`

Query `platform=windows|linux|macos|android-chat`; optional `profile=lite|full`. No auth needed because this is read-only release metadata. Sources the actually deployed `/download/latest.json` from the same Cloudflare asset binding, validates its schema, exact file names, byte length and SHA-256, and returns a structured plan. It never starts software, creates a tenant, allocates a device, or grants a write permission. `full` returns `FULL_RUNTIME_RELEASE_NOT_PUBLISHED` rather than falsely offering Lite as full Aura.

`android-chat` returns `CLIENT_ONLY`, indicating no on-phone runtime install. A missing release manifest returns HTTP 503 and no plan. SHA-256 protects bytes against accidental/corrupt transfer when the source manifest is trusted; this is NOT independent artifact signing. Publisher signatures and signed release policy remain release blockers.

## Phased delivery and gates

- G1: read-only install plan and negative tests; verify CI and deployed worker before claiming availability.
- G2: full Aura Windows installer built from reproducible commit, signed, rollback-tested and with real startup evidence.
- G3: move the **one** existing JACO Link host connection to Sentinel, preserve pair tokens and mission state, prove cold start without Core.
- G4: OAuth 2.1 consent and stateless remote MCP on existing JACO Worker; customer A/B isolation, scope/revocation and no generic shell exposure.
- G5: ChatGPT plugin install/connection and one-prompt guided bootstrap with user-authorized local execution; real mobile/desktop acceptance.
- G6: versioned cloud API adapter registry + local quarantine/verification/rollback; optional managed inference. No unchecked install or arbitrary hosted code execution.

## Existing owners / deduplication

- Customer transport: `site/jacocode.com/link.mjs` and `runtime/src/server/connected/jacoLinkHost.mjs`.
- Public site and releases: `site/jacocode.com/worker.mjs`, `lite/install.ps1`, `lite/install.sh`, `tools/build-lite.mjs`.
- Lifecycle: `runtime/gateway/src/sentinel.mjs` and `runtime/gateway/src/system-control.mjs`.
- API/Skill registration: existing MCP/provider registries and `agents/lib/skills.mjs`.
- One root agent: Aura; external ChatGPT is a control/model client and does not gain its own local agent identity.

Falsifiers: manifest corruption or unknown platform must fail; API prompt alone must not claim installation; Core-down status must not claim ONLINE unless Sentinel independently serves a paired Link; cross-account calls must fail; unknown write outcomes must not repeat.

## Optional migration: Sentinel Link ownership (code candidate)

The existing Core-embedded JACO Link host cannot receive a request when Core is stopped. The candidate moves the **same** outbound host connection into Sentinel only when `JACO_LINK_LIFECYCLE_OWNER=sentinel` is explicitly configured for the same host. The Core refuses to create its own Link socket in that mode and proxies its existing local pairing/status buttons to Sentinel using the existing shared gateway token over loopback.

The remote Link protocol adds two fixed verbs:

- `GET /api/jaco-link/system/status` → Sentinel SystemControl health projection; safe while Core is down.
- `POST /api/jaco-link/system/activate` with `{}` → only after both `JACO_LINK_REMOTE_ACTIVATE=1` and `JACO_MCP_ALLOW_ACTIVATION=1`; Sentinel invokes the existing `jaco activate` path and requires a fresh health probe. It never accepts a command or arbitrary executable path.

Opt-in requires a shared `JACO_GATEWAY_TOKEN` of at least 24 characters for Core-to-Sentinel pairing UI delegation. Unset `JACO_LINK_LIFECYCLE_OWNER` and restart services to roll back to embedded Core ownership; **do not leave both modes running**. The state file and pairing token are preserved. A real target-host migration, durable activation deduplication, verified restart and remote OAuth scopes remain pending. Do not advertise this candidate as a functioning cold-start path on a particular device until measured.

## Product boundary: JACO Cloud is not Render

Render (or another cloud compute provider) is the optional hosting substrate. JACO Cloud is a provider-neutral orchestration and installation product that may deploy to Render, manage authorized external cloud APIs, or connect customer-owned computers. Render is not an Aura agent, is not the tenant's identity authority, and MUST NOT be treated as the customer's account or the only supported backend.

The user's one-line intent ("Lös det med JACO") MUST be carried directly from authenticated ChatGPT to a single durable JACO mission handoff. The user must not copy/paste messages or relay receipts between ChatGPT and Aura.

### Durable handoff contract (new source candidate)

Source: cloud/control/handoff.mjs; negative tests: tests/nova/cloud-control-handoff.test.mjs. This specifies, but does not yet host, OAuth-authenticated mission submission with idempotency, read-scoped status, an internal dispatcher claim, and paired-host evidence receipts.

1. submit derives tenant and scopes only from a trusted OAuth verifier and authorizes the exact paired device. It reserves (tenantId, idempotencyKey) uniquely in a durable store; conflicting reuses fail. An HTTP response means ACCEPTED, not executed.
2. beginDispatch requires an internal dispatcher authorization and an atomic durable transition to UNKNOWN before network delivery, so ambiguous writes cannot be silently retried.
3. Host acknowledgements may progress DELIVERY_UNKNOWN to RECEIVED to RUNNING to VERIFIED or FAILED. Only an authenticated paired host may report those states. A VERIFIED receipt must carry an evidence reference; the server must independently validate evidence integrity and mission ownership before asserting success.
4. Customer A cannot access customer B's devices or missions. OAuth audience/expiry, host proof, device scopes and revocation belong to future production adapters and must never be derived from client-supplied JSON.

**Critical remaining work:** no public OAuth MCP endpoint, no actual persistent Postgres adapter, no Render deployment or hosted connection, no background dispatcher wired to JACO Link, no callback/push into an ordinary inactive ChatGPT conversation, and no host evidence attestation pipeline. The unit tests use an in-memory fake store only for contract testing. Do not represent this as operational JACO Cloud.

### Product decomposition

- JACO Cloud API / Control Plane: authenticated tenant/device identity, package catalog, durable job orchestration, status and receipts. Can run on Render or another backend.
- JACO Cloud Deploy Adapter: explicit connector for external cloud hosting APIs (e.g. Render) to deploy approved services; no reliance on the developer's personal account for customers.
- JACO Link transport: existing paired per-account outbound device channel, reused until there is a verified reason to replace it.
- Sentinel: local supervisor and future verified installer-recipe interpreter with bounded permissions and recovery.
- Aura / Continuum: the canonical sole agent; local mission graph, policy and verification remain authoritative.

A new unpaired computer still needs one trusted local bootstrap action. After pairing, subsequent goals should not require manual mediation between ChatGPT and Aura.

## Deployment boundary: future Render-backed JACO Cloud (Nov 21)

The dedicated hosted control plane (e.g. Render Web Service plus PostgreSQL) is distinct from the developer's private devices and must not impersonate the existing Google/JACO Link account. Render services already present in the operator's workspace are **not** automatically reused as customer control-plane infrastructure; no new service was deployed by this code.

The new pure `cloud/control/handoff.mjs` implements an **injectable** admission/lookup/dispatch/receipt contract, not a hosted route. Dispatcher authorization and completion-evidence verification are mandatory injected server-side dependencies, not callbacks supplied in customer request JSON. Untrusted ChatGPT requests never supply the tenant identity. OAuth must authenticate the token issuer, audience, expiry, scopes, revocation and fixed account/device binding before calling `submit()` or `status()`. The host must authenticate separately against the tenant and exact paired device. Only a trusted internal dispatcher may claim delivery, atomically marking the outcome `UNKNOWN` before network send. Only an authenticated receipt can resolve that uncertainty. The store MUST implement atomic uniqueness `(tenantId,idempotencyKey)` and compare-and-swap across host receipt transitions; an in-memory map or plain JSON file is not enough. A remote client must not be able to pass the dispatcher function or a fake verification receipt through a public HTTP route.

**Current status:** source contract + offline tests only. There is no Render HTTPS handler, OAuth service integration, PostgreSQL adapter, customer account enrolment, full local host receipt signature verification, ChatGPT plugin listing, or real mission dispatch in this PR. Do not claim `VERIFIED` is independently proven simply because a test host submits `verified:true` and an evidence reference; a production implementation must implement the `verifyEvidence` callback against trusted canonical Aura execution evidence (and reject fabricated references) before marking a mission terminal. The existing JACO Link protocol remains the transport candidate; do not create a second personal relay or a second Aura. Future distribution through marketplace plugins should implement thin adapters to the **same** OAuth + public JACO Cloud API, not duplicate cloud runtimes.
