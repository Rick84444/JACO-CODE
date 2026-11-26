---
name: Autonomous API connection discovery
description: Discover the public APIs needed for an active mission through local guarded Fetch and scoped CDP, then connect only authorized services via the existing Vault.
tasks: [mcp-call, mcp-write, browser-survey-site, browser-click, browser-type, web-fetch, vault-list-secrets, vault-generate-secret, secret-store]
---

# API connection acquisition

1. Aura identifies a service needed for the active mission, its official domain and whether a free permitted API exists. Use connect.discover_public_api first. It returns bounded public metadata, not a validated API, raw secrets or executable instructions.
2. When the API specification is missing or incomplete, use the existing CDP browser-survey-site on official documentation. Use a dedicated authorized provider-account session; never enumerate unrelated tabs, browser storage, network authorization headers, cookies, passwords or keys. Respect platform terms and access boundaries. Prefer existing API/OAuth or MCP over UI automation.
3. Verify endpoint ownership, free-tier limits, auth, required scopes, and terms. If no safe API exists, record UNAVAILABLE and choose another service. Never auto-connect a credential to a discovered arbitrary domain.
4. Check Vault metadata (connect.secret_status) before asking for new credentials. For a service explicitly authorized by the operator, use the existing provider console's normal key creation workflow and existing secret capture/store reference, never place a value in model context, logs, task instructions, source or a public Git receipt. Do not capture keys on public web pages. Do not reuse credentials from another identity/service. Existing runtime mandate and origin checks still apply. If authorization or safe capture is absent, mark NEEDS_OPERATOR and continue unrelated tasks. A public discovery result never grants account or credential writes.
5. Verify using official least-privilege read endpoint (not sending a payment or billable inference), differentiate DISCOVERED, NEEDS_AUTH, CONFIGURED, VERIFIED and AUTH_FAILED. Use existing Vault storage and runtime evidence. Do not overwrite or rotate a known working secret automatically.
6. Re-evaluate a failed connection with bounded backoff in the existing Aura mission loop, then use an alternative source or report the exact blocker. Never create a separate background agent or recurring process.

Existing CDP/Fetch tools here are orchestration steps, not evidence of a live connection. No approval bypass, no global credential harvesting, no automatic financial activation.

## Reuse approved Plugin Center connections
- Discover the live MCP catalog first. Prefer an already configured Render, Cloudflare, GitHub, Hugging Face, Linear, Context7 or Stripe plugin to inventing a new integration. The catalog is not execution evidence.
- If authentication is needed, use the authorized account-page launcher only after the operator enabled the plugin's `allowOpenLogin` option. In the full Aura toolbox use `plugin_login({plugin:"render"})`; in a mission use the advertised `jaco-plugin-center.open_login` via the existing `mcp-write` task and its input schema. Never call an unadvertised tool or use shell/CDP to bypass a refused launch.
- The opener accepts only plugin IDs with reviewed provider URLs, not arbitrary URLs or authentication redirects. An accepted browser launch is not a sign-in. If a provider needs a password, MFA, an OAuth grant or API key, the operator completes that step using the official site and existing Vault. Existing valid stored credentials are reused by the MCP host.
- After the operator completes setup, rediscover tools and make a permitted low-risk read call. If still unauthorized, record NEEDS_OPERATOR rather than looping on sign-in. Never approve new permissions or perform financial operations merely because a plugin is configured.
