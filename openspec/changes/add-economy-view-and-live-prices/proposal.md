# Economy view, live model prices, native local Ollama and enforced org permissions

## Why
- Costs were estimated with one fixed reference rate per unknown model, so the cost chip overstated cheap models by about ten times and the operator could not see income and spend side by side. Revenue sat in a sidebar that showed Stripe only.
- Ollama's OpenAI-compatible endpoint ignores `options`, so local planners ran with the default 4096-token context and silently lost half of JACO's planner prompt (observed 2026-11-01).
- A model that answers text but refuses tool calls passed the planner probe, then left every mission without a planner.
- The organization panel stored permissions that nothing at runtime checked.

## What Changes
- One Economy workspace (`EconomyView`) with costs per model, revenue (Stripe, agent orders, verified mission revenue), provider balances and the prices in use. It replaces the Revenue sidebar; the cost chip opens it.
- A price catalog (`runtime/src/server/aura/priceCatalog.mjs`) fetched from public lists (LiteLLM, OpenRouter) every 6 hours and kept in the state directory. Each price carries its source and fetch time. A model with no catalog price, operator price or operator default price is not used: spending stops instead of guessing.
- Local Ollama chats go through the native `/api/chat` endpoint with an explicit `num_ctx` and answer in the OpenAI shape (`agents/lib/ollama-native.mjs`).
- The planner probe offers one tool; a model that refuses tools fails with `PLANNER_MODEL_NO_TOOLS`.
- Org permissions are enforced (`agents/lib/org-permission.mjs`): Aura's mapped chat tools and Nova's mapped tasks check the mandate chain before every call.

## Impact
- Affected: `runtime/src/server/aura/costEngine.mjs`, `priceCatalog.mjs`, `runtime/src/server/connected/economicBudget.mjs`, `providerRegistry.mjs`, `agentOrganization.mjs`, `runtime/server.ts`, `agents/hands-off-agent.mjs`, `agents/lib/planner-choice.mjs`, GUI components.
- Behavior change: paid models without a known price are blocked until prices are fetched or the operator sets `JACO_AURA_DEFAULT_PRICE_JSON` / a price file. Previously they ran at the reference rate.
- No new spend, payment or secret path. The price fetch is a read-only GET of public catalogs.
- Baseline: `main` 0d61684.
