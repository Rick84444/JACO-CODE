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
