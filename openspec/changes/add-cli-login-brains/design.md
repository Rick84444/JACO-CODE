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
