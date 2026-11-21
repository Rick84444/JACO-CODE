# Canonical JACO capabilities — one owner per product function

Status: ADR accepted for new work. Existing running deployments require migration
evidence; changing this repository does not stop a process already running on
an operator device.

## Non-negotiable build rule

**Search before creating.** For every requested feature, inspect the active
repository, internal packages, integrations, tests, OpenSpec changes,
installed Skills and `legacy/` for existing implementations. Inspect actual
callers and evidence rather than relying on similar or different names.

Choose one canonical implementation based on verified capabilities, safety,
test coverage, maintainability, portability and recency **in that order**.
A newer commit alone is not grounds to replace a better working subsystem.
Extend or migrate the owner. Do not instantiate another server, relay,
planner, memory, tool registry, approval engine, or root agent with the same
responsibility under a new name.

For each replacement, enumerate all call sites, exported APIs, startup
scripts, configuration flags, state files, CI workflows, documentation and
runtime dependencies. Add a migration or compatibility adapter only when
needed; adapters have a retirement condition and must not own state. Once
all active callers are migrated and target-host evidence exists, disable the
old launch path, move its historic implementation/docs to `legacy/` or delete
it if no historical value, and remove obsolete flags, examples and tests.
Never move a live module while a supervised process still imports it.

## One agent — no extra personas

Aura is the **only agent**. SEER/strategy and Nova/execution are legacy names
for functions being moved into the existing Aura Runtime; Sentinel is a
standalone non-agent lifecycle supervisor required for cold-start.
Tool and mission workers do not gain their own goals, durable memory or
operator-facing identity. Refactoring function ownership does not authorize
deleting active process data or abandoning real mission receipts.

## One Relay — the canonical product decision

**Customer transport owner:** `JACO Link`, not GitHub. Key components:

- `site/jacocode.com/auth.mjs`: existing Google OpenID Connect JACO account.
- `site/jacocode.com/link.mjs`: per-account JACO Link rooms and pairing.
- `site/jacocode.com/link-protocol.mjs`: bounded remote operations.
- `runtime/src/server/connected/jacoLinkHost.mjs`: one outbound-only host
  connection to that account's canonical Aura, not a second runtime.
- `runtime/server.ts`: the same Core/SEER/Mission Bus/Nova, ledger, policy and
  verified receipts for local IDE, mobile JACO and eventual ChatGPT.

**ChatGPT entry:** one published account-bound HTTPS MCP plugin with OAuth
delegation, passing verified account, device and scope to the **same** JACO
Link transport. It is not another relay server on the user's computer. This
plugin/OAuth layer and mobile ChatGPT acceptance are not yet implemented;
see `openspec/changes/chatgpt-google-account-relay/`.

**Reverse call/callback:** Aura writes an operator-visible, bounded,
durable request-for-assistance event through the same authenticated channel.
A receiver/ChatGPT invocation may respond only if the user has connected the
plugin and the host supports it. Merely writing a callback event is not proof
that a ChatGPT conversation/model was awakened.

### Legacy inventory and transition

| Existing implementation | Disposition | Startup policy |
| --- | --- | --- |
| `gateway/src/chatgpt-nova-gateway.mjs` | Legacy HTTP ChatGPT actions facade. No customer production routing. | Explicit `JACO_ENABLE_CHATGPT_GATEWAY=1` only; CDP flag must not start it |
| `runtime/gateway/src/github-bootstrap-control.mjs` and `runtime/bin/sentinel-windows.mjs` | Legacy Git bootstrap, fixed public control verbs. Preserve until all active boot receipts are migrated. | Off on new installs; existing explicit opt-in preserved |
| `agents/lib/github-control-inbox.mjs` | Legacy Nova Git control inbox. Policy-bound, not interchangeable with JACO Link. | Preserve existing explicitly used installations; no customer onboarding |
| `gateway/src/workplace/chatgpt-github-relay.mjs` and `chatgpt-git-ref.mjs` | Legacy Git communication transport, no mission authority. | Off by default; developer-owned repo only, never built-in personal account |
| `runtime/gateway/src/mcp-cognitive-stdio.mjs`, `mcp-aura-private-stdio.mjs` | Local/private MCP development and diagnostic interface. Useful while testing OAuth; not a second customer transport. | Explicit opt-in in trusted local environment |
| `agents/remote-bridge.mjs`, `agents/nova-bridge.mjs`, browser/CDP bridge | Local execution/device adapters, **not** competing customer Relays. | Keep only where the canonical runtime actually requires their distinct capability |

Actual process inventory and received command receipts are required before
retiring any legacy listener. A historical file name is not evidence that a
second runtime is active. Do not shut down an already-running path before
the canonical replacement has produced a real accepted mission and a verified
execution receipt.

## Known compatibility debt not silently removed

- `agents/lib/github-control-inbox.mjs` still has a historical default
  developer repository for existing standalone Nova Git missions. New
  customer Relay and OAuth MCP code MUST NOT call or depend on this module;
  migrate those explicit operators to JACO Link with real mission receipts
  before changing its default or relocating the module.
- Older operator `~/.config/jaco/runtime.env` may already contain
  `JACO_GITHUB_BOOTSTRAP_ENABLE=1`. The new installer preserves it rather
  than silently interrupting real in-flight commands. Only new installations
  default to disabled; migration needs an operator-visible state diff.
- The embedded JACO Link host cannot currently activate a stopped Core
  because it runs inside Core. Cold start requires ownership transfer to
  existing Sentinel and a real bootstrap/ready receipt, not a second Link
  instance.

These are tracked retirement blockers, not parallel product features.
A legacy source file being left in place does NOT mean its lifetime is
unbounded.

## Release acceptance

1. One JACO account / Google subject, one chosen paired device, one Aura
   runtime, one mission ID, one source of receipts.
2. Authenticated ChatGPT MCP connection may request status/goal/steer from
   a mobile or desktop ChatGPT chat, using only approved scopes.
3. When a device is offline, report OFFLINE or UNKNOWN; never claim
   successful invocation from cached GitHub state.
4. No default developer GitHub repo, duplicate customer tunnel, manual
   gateway-token prompt, public mission text or cross-tenant routing.
5. Explicit legacy disablement plus a documented rollback after target-host
   proof. Retain historical code under `legacy/` only once imports and
   startup ownership are fully migrated.
6. CI tests block implicit startup of the legacy ChatGPT gateway and Git
   bootstrap on new installs; customer-link controls stay account-bound.

## Merge protocol

Before creating any production module, include an implementation lookup:
`existing_owner`, `alternatives`, `decision`, `callers`,
`migration`, `legacy_retirement`, `falsifiable_tests`.
Stop creating functionality if the existing owner can be extended.
