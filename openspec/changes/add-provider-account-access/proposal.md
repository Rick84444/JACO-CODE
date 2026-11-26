# Add provider account access

## Why
JACO already supports Gemini and OpenAI API keys, but onboarding should support the user's eligible ChatGPT plan and current Google AI Studio credentials without a new runtime or provider registry.

## Scope
Extend the canonical runtime provider, existing credential store and connection UI. ChatGPT plan usage is optional and separate from JACO identity and API billing. Google AI Studio uses a user-owned Gemini API project; Google consumer subscriptions do not imply API credits. Google OAuth is a separate optional project-based integration.

## Acceptance / falsifier
On a local user-controlled host, complete real authorized ChatGPT and Gemini requests, surface provider and billing mode, reconnect after expiry/restart, and stop on denied consent, revoked credentials or limits. Any credential reaching cloud relay, logs, browser storage, prompts or another account, or automatic paid fallback without consent, falsifies acceptance. Until target-host proof, do not advertise either new flow as production-ready.

## Sources
- https://developers.openai.com/siwc/token-sharing-open-source
- https://openai.com/policies/sign-in-with-chatgpt-terms/
- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/oauth

## CLI clarification (2026-11-26)
Google moved individual Free/Pro/Ultra access from Gemini CLI to Antigravity CLI on 2026-06-18. Evaluate official Gemini CLI ACP for eligible enterprise accounts and official Antigravity CLI for individual users as bounded task delegation, not as an unrestricted inference provider. No reuse of CLI OAuth credentials in JACO. Verify third-party usage terms before enabling either bridge.
Sources: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/ ; https://geminicli.com/docs/cli/acp-mode/ ; https://geminicli.com/docs/resources/faq/ ; https://antigravity.google/docs/cli/headless/
