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
