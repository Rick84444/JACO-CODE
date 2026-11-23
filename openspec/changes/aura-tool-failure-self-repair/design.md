# Design: diagnosis inside the existing loop

## Decisions
1. `diagnose` is an injected dependency of `runAgentMission`; without it behaviour is unchanged.
2. At most four diagnoses per run and once per distinct failure; notes are appended after the tool results of the turn so tool-call protocol order is preserved.
3. Remedies are limited to starting an already configured MCP server (`/api/mcp/start`) and starting the canonical launcher, rate-limited to once per five minutes. No kill, no install, no config change.
4. A failure with `outcomeUnknown` is not diagnosed by retrying; write retries stay forbidden.
5. Log text is redacted with the existing secret redaction before the model sees it.
6. A throwing diagnosis is logged and ignored; it must never stop a mission.

## Risks
A misclassified failure produces wrong advice but no side effect beyond a start request. Repeated stack recovery is bounded by the cooldown.
