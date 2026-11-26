# Design
Reuse runtime/src/server/connected/providerCatalog.mjs, existing registry, provider adapters, authenticated operator UI and credential store. Do not add a parallel planner or registry. Audit existing consumers before modifying transport.

## ChatGPT
Use the official open-source SIWC dynamic registration, stable host ID, system browser and loopback callback, per-attempt state/nonce/PKCE S256, issued client ID, exact redirect URI, validated signed ID token (issuer, audience, nonce, expiry), and explicit chatgpt.tokens.use.direct consent. Store account-bound credentials only under the local user's control; never expose tokens to model tools, other users, UI or cloud. Use the documented Responses API resource and eligible model discovery; refresh and revoke per upstream contract. An identity grant alone is not inference authorization. Require express consent for background usage; no account pooling, proxy access for other apps, or limit circumvention. SIWC plan access must not require a paid JACO tier.

## Gemini
Link to https://aistudio.google.com/apikey, import restricted API credentials through the existing protected local credential flow, recognize standard and AQ authorization keys, validate using the official Gemini API/SDK (native x-goog-api-key). Keep the existing OpenAI-compatible adapter only where verified; do not send both credential headers. Model availability is discovered, not assumed. Optional OAuth must use a registered Google client, project and approved scopes, not Gemini website session cookies. Project quotas and billing remain separate from consumer plans.

## Routing and visibility
Expose only redacted account status, chosen billing mode, consent, expiry/reconnect status and provider availability. On errors fail closed; no silent paid fallback or unlimited claims. Render and Cloudflare remain distribution/relay only for this local flow. No credential upload. Preserve existing API-key and local-model paths.

## Validation strategy
Baseline existing API-key provider flows; compare completion and reconnect on matched tasks. Negative controls: mismatched state/nonce/identity, expired token, denied scope, revoked consent, rate limit, foreign account, unauthorized background execution, cloud/secret leakage, unapproved paid fallback. Mock HTTP tests do not prove live provider availability. Verify exact revision with existing CI and manual Windows-host acceptance; Android PWA is a remote view, not a credential store.
