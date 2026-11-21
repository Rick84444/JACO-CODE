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
