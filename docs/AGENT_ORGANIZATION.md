# Agent organization

The operator runs JACO's agents as a company. The operator is CEO, Aura is vice CEO, and every other agent reports to a manager. Owner: `runtime/src/server/connected/agentOrganization.mjs`, with the operator UI routes at `/api/aura/organization` (local UI only, same origin).

## State

`$JACO_STATE_DIR/org/` (default `~/.jaco/org/`), outside Git:

- `organization.json`: the one store for identity, manager, model, mail, task, goal, status, mandate and traits. A store that cannot be read fails closed (`ORGANIZATION_STATE_CORRUPT`). It is never silently reset.
- `audit.jsonl`: every grant, revoke, hire, limit, trait and status change, with the actor.
- `agents/<id>/`: the agent's own `rules.md`, `skills/`, `memory/` and `mcp.json`.

## Mandate

Each permission has a risk level:

- **Low**: read files, receive mail.
- **Medium**: write files, run commands, push to own branch, cloud models within budget.
- **High**: merge, browser, send mail, publish, create sub-agents.
- **Locked**: payments.

Rules:

- **Ceiling chain.** `authorize(id, permission)` allows a permission only while the agent and every manager up to Aura are active and hold it. Revoking or pausing a manager therefore stops its whole branch.
- **Granting.** A permission is granted only if every manager above already holds it. Agents may grant low and medium permissions within their own branch. Only the operator grants high-risk permissions, and only with `acceptRisk`. Nobody can grant payments.
- **Hiring.** An agent with `agents.create` may hire up to `maxSubAgents` agents into its own branch. Each hire is `pending` until the operator approves it, unless the operator has set `autoApproveSubAgents`.
- **Pausing.** A manager cannot resume an agent the operator paused.
- **Budget.** The effective `budgetUsdPerDay` is the minimum along the chain. The Continuum EconomicGovernor remains the global ceiling.

## Traits

There are five weights, each 0–100: `toolUse`, `agency`, `freedom`, `rigor`, `reporting`. The first three govern autonomy and are capped by the manager's effective value.

`workingWeights(id)` compiles them into limits the runtime can enforce, plus a short brief the agent reads:

| Field | Range |
|---|---|
| `maxToolCallsPerStep` | 0–20 |
| `stepsBeforeCheckIn` | 1–20 |
| `scope` | task, adjacent, open |
| `mayProposeGoals` | true or false |
| `evidence` | self-check, tests, tests and review |
| `reportEveryMinutes` | 240 down to 15 |

## Not yet wired

The organization is a store and a check. Nova, Aura chat, MCP tools and mail do not call `authorize()` or apply `workingWeights()` yet. Until they do, an agent's mandate in this store limits nothing at runtime.

Planned next steps:

1. Organization view in Aura.
2. Wake service in Workplace that runs an agent under its mandate and weights.
3. Per-agent mail through `jaco-inbox`.
4. Nova proposing hires.
5. A Cloudflare worker template.
