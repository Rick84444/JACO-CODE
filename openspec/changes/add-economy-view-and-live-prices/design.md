# Design

## Owners
No new owner. Prices and cost books stay in the runtime's cost engine and economic governor; the economy route extends the existing budget router (`/api/aura/budget/economy`). Planner choice stays in `agents/lib/planner-choice.mjs`; the organization store stays in `agentOrganization.mjs`, with a shared read-only check in `agents/lib/org-permission.mjs` because Nova runs in its own process.

## Price resolution
Order (`modelPrice` in `costEngine.mjs`): environment JSON (`JACO_AURA_PROVIDER_PRICES_JSON`) > operator price file > OpenRouter `:free` models at zero > catalog price > operator default price (`JACO_AURA_DEFAULT_PRICE_JSON`) > highest catalog price of that provider (model missing) > catalog median (provider missing) > `MODEL_PRICE_UNKNOWN`. Before any catalog is fetched, only the first three and the operator default can price a call. Local providers cost nothing. A broken operator file stops spending (`AURA_PROVIDER_PRICES_INVALID`). A catalog response with too few rows never replaces known prices.

## Native Ollama
`withLocalOllamaContext(fetch, env)` wraps any fetch. Only POSTs to a loopback `/v1/chat/completions` on Ollama's port are rewritten to `/api/chat`; everything else passes through. Error bodies keep their message, so a tools refusal is still recognized by callers.

## Permissions
`authorizeChain` requires the agent and every manager above it to be active and hold an unexpired grant. An installation without an organization, or without that agent in it, is not restricted. An unreadable store stops Nova's mapped tasks (fail closed). Denials are `MANDATE_DENIED:<agent>:<permission>:<reason>` and are never auto-resumed by approval policy.

## Falsifiers
- A paid model without any price runs: falsified by `tests/nova/aura-cost-engine.test.mjs`.
- A local Ollama planner request goes to `/v1/chat/completions` without `num_ctx`: `tests/nova/ollama-native.test.mjs`.
- A revoked manager's report can still read files: `tests/nova/agent-organization.test.mjs`.
