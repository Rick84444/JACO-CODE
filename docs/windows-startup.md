# Windows startup and shared cloud budget

Double-click `JACO-start.vbs`, or run `npm run jaco:start` from the installation root. All Windows entry points delegate to `agents/lib/local-stack.mjs`; Workplace remains the sole supervisor of SEER and Nova. Children use hidden console windows and append logs to `logs/startup/`. Existing terminal windows are not closed by the launcher.

## Installation configuration

Install Node.js 24 or later and install dependencies in both the installation root and runtime package. The desktop entry point supports a bundled `tools/node/node.exe` or an explicit process environment variable `JACO_NODE_EXECUTABLE`.

The runtime is discovered from `server.ts` and `package.json` in the installation root or one immediate child directory. Multiple candidate runtimes require `JACO_RUNTIME_DIR`. Relative paths resolve against the installation root, independent of the current terminal directory. Readiness checks compare the runtime's product identity and its package version, rather than a release folder name.

Root `.env` supplies configuration; inherited process environment takes precedence. Required gateway credentials must be configured before launch. Missing prerequisites stop startup; the launcher does not invent credentials or authorize paid work.

| Setting | Purpose |
| --- | --- |
| `JACO_RUNTIME_DIR` | Optional runtime path, relative or absolute |
| `JACO_START_MODE` | `auto` prefers a complete build; `source` uses tsx; `production` requires `dist/server.cjs` and `dist/index.html` |
| `PORT`, `JACO_WORKPLACE_PORT`, `SEER_PORT`, `JACO_REMOTE_BRIDGE_PORT`, `JACO_A2A_PORT` | Core listeners; established ports remain defaults |
| `JACO_ENABLE_CDP=0` | Turns off Chrome (dedicated JACO profile) and the browser bridges, which start by default so the agent connects its own browser |
| `JACO_ENABLE_CHATGPT_GATEWAY=1` | Starts the ChatGPT Nova gateway (opt-in; `JACO_ENABLE_CDP=1` still starts it for existing setups) |
| `CDP_PORT`, `NOVA_BRIDGE_PORT`, `JACO_CDP_BRIDGE_PORT`, `JACO_GATEWAY_PORT` | Browser and gateway listeners |
| `JACO_CHROME_EXECUTABLE`, `JACO_OLLAMA_EXECUTABLE`, `JACO_CLOUDFLARED_EXECUTABLE` | Optional executable paths; vendor locations and PATH are fallbacks |
| `JACO_CHROME_PROFILE_DIR` | Optional dedicated Chrome profile directory |
| `JACO_START_TUNNEL=1` | Explicit opt-in to the configured Cloudflare tunnel |
| `JACO_TUNNEL_CONFIG` | Existing tunnel configuration; default `logs/cloudflared-config.yml` |
| `JACO_IDE_PUBLIC_HOST` | Exact authorized remote IDE hostname matching an existing tunnel ingress; remote IDE login remains required |

Build the runtime client and server before distribution and use `JACO_START_MODE=production` for an installed release. Production startup sets `NODE_ENV=production`; source startup is a development mode. No developer username, absolute installation directory, or model name is required by the launcher.

## Readiness and recovery

`npm run jaco:preflight` reads configuration without launching services. `npm run jaco:status` observes service identities. Startup rejects invalid or overlapping ports, an emergency latch, unknown listeners, conflicting startup locks and unverified process ownership. A timed-out process is retained in an ownership record and is not blindly launched a second time. Separate Workplace and gateway credentials are respected.

The optional `agents/watchdog.ps1` reconciles through this same launcher. It can be invoked with `-Once` for one check or `-IntervalSeconds` for repeated checks; it does not maintain a second port map or unload models. It is not installed as a Windows login task by this change.

`logs/startup/status.json` is a local readiness receipt. `READY` refers to checked local services. A Cloudflare process is reported separately as `PROCESS_PRESENT_PUBLIC_REACHABILITY_UNVERIFIED`: external reachability and account/API permissions require separate verification. Browser opt-in creates a runtime tab if needed and requires a successful attachment.

## Budget

Aura displays and edits daily, monthly and per-task USD limits through `/api/aura/budget`, backed by Continuum's existing EconomicGovernor. These are shared ceilings for calls using that governor, not a limit on subscriptions or requests made outside JACO. Budget editing does not enable providers, background cloud execution or account billing.

The governor persists the policy and reservations. Lowering a budget does not erase spending or release unresolved reservations; new calls stop when headroom is exhausted. Restart preserves operator policy instead of re-enabling cloud execution from an old environment flag. Invalid values are rejected before mutation. Local unpriced inference remains independent of the cloud budget.

Ollama cloud calls require explicit model prices in `JACO_AURA_PROVIDER_PRICES_JSON` (keys `ollama/model` or `ollama-cloud/model`) or `JACO_OLLAMA_CLOUD_PRICES_JSON` (model keys). Values have positive numeric `input` and `output` USD per million tokens. The latter overrides the general price configuration. Missing prices block dispatch; no model or price is built into this manual-chat path.

## Verification boundary

Run the startup, provider-budget and Workplace supervisor tests, runtime typecheck and production build. Verify both reuse and restart on the target machine. A successful local restart does not prove Windows reboot recovery or startup on a clean machine; these remain release acceptance checks. Guided external API/MCP onboarding is a separate capability and is not implied by web login or this launcher.
# Nova reasoning time

`JACO_NOVA_REASONING_TIMEOUT_MS` defaults to 600000 (10 minutes per model request).
`JACO_NOVA_PLAN_BUDGET_MS` defaults to 1200000 (20 minutes for the entire planning turn, including fallback and cooldown waits).
Both accept integer milliseconds from 15000 to 3600000; the request timeout must not exceed the turn budget.
The canonical mission owner derives its exclusive planning lease from the turn budget plus one minute.
Joined executors receive the actual hub deadline and reserve time to begin or release the turn.
Execution leases remain five minutes: an expired mutation is still quarantined for reconciliation.
Set these variables in the installation `.env` and restart the runtime and Workplace supervisor together.
These settings do not change spending permission, model output token limits, or the coding mission's separate duration contract.
