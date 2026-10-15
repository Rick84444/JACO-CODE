# JACO Autonomus IDE 0.19 WIP — Reuse / Wrap / Build Matrix

This is the mandatory design gate before new infrastructure is written.

| Layer | Mature external implementation | JACO decision | JACO-specific layer retained |
|---|---|---|---|
| MCP protocol/transport | Official Model Context Protocol TypeScript SDK v2 (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`) | **REUSE** | JACO tools, contract policy, Nova/SEER semantics |
| Private/local MCP → OpenAI | OpenAI `tunnel-client` / Secure MCP Tunnel | **REUSE/COMPATIBLE** | JACO Sentinel/MCP endpoint, local policy; do not invent raw public tunnel |
| Browser transport | Playwright MCP / Chrome DevTools MCP / CDP | **WRAP** | Nova target lock, survey memory, semantic guards, receipts, autonomy contract |
| Android generic UI actuation | Appium UiAutomator2 where a host/ADB stack exists | **WRAP/HYBRID** | JACO Companion + native Accessibility fallback for on-device/offline mode |
| Windows UI Automation | FlaUI | **WRAP** | JACO Desktop policy, leases, semantic receipts |
| A2A protocol | Official A2A JS SDK/TCK | **REUSE** | JACO skills, marketplace, routing/economics |
| Provider plumbing | LiteLLM class of router/proxy | **BENCHMARK/WRAP** | JACO strategic model selection and mission policy |
| Durable workflow/checkpoints | LangGraph / Temporal | **BENCHMARK BEFORE BUILD** | SEER mission semantics and operator-visible state |
| SEER | No commodity replacement selected | **BUILD** | JACO core |
| Nova | No commodity replacement selected | **BUILD** | JACO core |
| Autonomy contracts | Product-specific | **BUILD** | JACO core |
| Semantic evidence/receipts | Product-specific composition | **BUILD** | JACO core |
| Cross-surface single-writer coordination | Product-specific | **BUILD** | JACO core |
| Antigravity / AI Studio integration | Product-specific | **BUILD/PRESERVE** | Canonical JACO GUI |

## Rule

Before adding a new subsystem, record: current JACO implementation, best historical JACO implementation, at least 3 credible external implementations when the category is mature, and a written REUSE/WRAP/BUILD decision. A new custom implementation is blocked until that gate is complete.
