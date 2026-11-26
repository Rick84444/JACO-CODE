# Design

## Owner
`cliBrains.mjs` owns CLI detection, sign-in and completion. `ProviderRegistry` stays the only provider list; `server.ts` adds three routes next to the existing provider routes.

## Flow
1. `GET /api/aura/workbench/brains` returns, per vendor, `{ id, label, installed, loggedIn, detail, loginKind, loginHint }`.
2. `POST /api/aura/workbench/brains/:id/login` (local UI only) starts the CLI sign-in. `loginKind: 'browser'` (claude, codex): the CLI opens the browser on the JACO host and the first `https://` URL it prints is returned so the operator can open it elsewhere. `loginKind: 'terminal'` (gemini has no login subcommand): the response carries the one command to run in a terminal.
3. The GUI polls the status route. On `loggedIn` the server calls `registry.registerCliBrain(id)`.
4. `registry.chat()` for a `cli-login` provider calls `cliBrains.complete()`: prompt on stdin, tools disabled, no session persisted, 120 s timeout, 1 MiB output cap, non-zero exit or empty text throws.

## Decisions (my calls)
- Child environment is an allow-list (PATH, HOME, proxy and CA variables, locale), not process.env.
- Synthetic `baseUrl` `cli://<bin>` so existing `new URL(p.baseUrl)` consumers keep working; nothing fetches it.
- Logos are small inline SVG marks, flat, muted; no remote assets.

## Extension: provider-specific entitlement (2026-11-26)
Shell remains available to Aura through its existing execution boundary; vendor CLI subprocess arguments are fixed and validated. No new execution authority is granted by login.
- OpenAI: prefer direct official SIWC for local open-source JACO (dynamic client registration, stable host ID, loopback PKCE and verified ID token, scoped access, local account isolation, Responses SSE terminal completion). https://developers.openai.com/siwc/token-sharing-open-source
- Anthropic: third-party Claude subscription routing is not generally permitted without an applicable approval; keep manual vendor CLI usage separate from JACO inference. https://code.claude.com/docs/en/legal-and-compliance
- Google: Gemini CLI individual plans moved to Antigravity on 2026-06-18; do not infer entitlement from an OAuth file. Use AI Studio project API, and evaluate official CLI delegation separately. https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals
- No automatic registration from a read-only GET or status-only proof. Do not send raw stderr or arbitrary sign-in URLs to UI. Unknown entitlement remains unverified. No API billing fallback, shared plan, or credential extraction.
- Acceptance: target host real authorized inference, explicit operator consent for background use, scope/revocation/limit negatives, safe output parsing, clean CI. Until that proof, block subscription routing rather than advertise readiness.

## Compact provider UI
Replace the always-expanded provider forms with one compact logo strip (OpenAI, Claude, Gemini, other). Each opens one native modal dialog with only the selected provider's actions; keep API key entry on the existing provider/key endpoint with an explicit provider ID, and retain custom URL/auto-detection under Other. No credentials in the launcher; no automatic login, activation or model request when opening. Distinguish sign-in from observed model response. Keep pending OAuth UI state across modal closure; clear API-key fields on unmount. Native modal focus containment, Escape, explicit close, backdrop dismiss and responsive scroll are acceptance criteria. No change to shell, auth entitlement or routing. Validate desktop/mobile and keyboard with actual UI before release.

## Source control / Actions visibility
Extend the existing Source Control view, not a second Git implementation. Read the open project's origin via Git and use the installed official gh CLI to list recent workflow runs for that repository; read-only, fixed arguments, bounded output and timeout, no token exposure or arbitrary URLs. Show actual status/conclusion, branch, commit, update time and validated GitHub run links. Explicit refresh only; no automatic workflow execution, retries or permission changes. Unit-test valid/invalid origin and output, and credential isolation. Existing Git operations remain canonical. Subscription gate also checks these contracts.

## Plugin Center and reusable account-page opening
Reuse the official MCP catalog, local operator server configuration, HTTP bearer transport, Vault and the existing API connection skill. Add Cloudflare API, Linear, Context7 and Stripe presets; preserve existing Render, GitHub and Hugging Face presets. Operator explicitly enables allowOpenLogin on a configured plugin; false by default. Match the exact reviewed endpoint and credential reference at every invocation. Only missing credentials or observed auth failure may initiate an OS browser-launch request. Rate-limit per plugin; no provider tokens in child environment. Refusals or changes to plugin config, operator capability or commands mandate take effect at next invocation. The full Aura toolbox and authorized mission mcp-write task share the same launcher. No OAuth grant submission, password capture, browser control, financial action, or automatic consent. An OS launch acknowledgement is not proof of sign-in. General OAuth callback, persistent refresh and live provider handshake remain outstanding; use existing Vault references until then. Tests cover catalog, opt-in persistence, endpoint pinning, refusal, rate limiting and credential isolation; CI execution and target-host browser behavior are not yet observed.
