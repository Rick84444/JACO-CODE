# Aura English-first and naming migration — 2026-11-02

## Product invariants

- **Aura is the only operator-facing AI agent.** Reasoning, planning, memory,
  execution, tools, verification and cost control are Aura capabilities. Do not
  create independently selectable SEER, Nova, Origo, Mimir or Balder personas.
- **English is the default product and source language.** The existing shared
  `UiLanguageProvider` still offers Swedish (`sv`) in the GUI. Changing a
  locale must update every displayed label, including errors and accessibility
  names; a secondary panel must not keep a private locale preference.
- **Model prompts are authored in English but replies use the user's language.**
  This does not license removal of Swedish command recognition, literal Swedish
  user messages, translation dictionaries or test data. Security instructions
  and read-only Manual/Planning contracts must survive translation unchanged.
- **The durable mission ledger is the system of record.** Chat responses and
  screenshots are not evidence that code ran. Stop/steer, provider choice,
  approvals, budget reservations and execution receipts are not reimplemented
  as part of this language cleanup.

## Repo inventory and names

Snapshot: `main` at `85c146a54280d1b8f86ed7245424c1f61ac5633f`.
The repository contains 1,109 tracked files, including 39 runtime GUI components,
and approximately 45 paths with `seer`/`nova` filename prefixes.

| Existing surface | Product terminology | Migration policy |
| --- | --- | --- |
| SEER / strategic governor | **Aura Strategy Runtime** | Rename UI and product docs now; leave `/cortex/*`, stored goal IDs, state files and service entry points until versioned migration is tested. |
| Nova / hands-off mission executor | **Aura Durable Execution** | Rename displayed actor and selector labels now; preserve `stableId=nova`, mission owner, executor routes and lease continuity. |
| SEER planning/model choice | **Aura planning model** | Keep the backed `/api/nova/planner` endpoint and saved provider preference. Do not fork model selection or charging. |
| Workplace | **Aura workspace/session infrastructure** | May stay technical in diagnostics; no claim of a physically consolidated single OS process. |
| MCP/skills/specialists | **Aura tools, skills and delegated capabilities** | A profile is not an independent AI authority merely because it has a name. |
| `src/` root legacy desktop UI | **Legacy, excluded from root release package** | 46 tracked files and older multi-tab/mock architecture; inspect test/build/import references before deleting. Active product client lives at `runtime/src/App.tsx`. |
| `NOVA_SURVEILLANCE_README.md` | **Removed** | The unreferenced doc described an unverified Electron surveillance feature as production ready; do not expose as a shipping feature. |
| `runtime/RELEASE_FILES.sha256` and old release guides | **Historical evidence only** | Do not delete checksum/source-of-provenance artifacts without checking release verification consumers and retention requirements. |

## Implementation and conflict resolution

PR #138 translated 129 files but branched before the newest Aura chat/control
changes; ten files conflicted with current `main`. PR #143 ports all 119
unchanged-base translations by exact blob identity and selectively reapplies
the English text from the other files without discarding later
chat/stop/steer/provider/security changes. It intentionally does **not**
restore the old policy mutation sniffing from
`runtime/src/server/connected/cognitiveQuestionToolbox.mjs`; Manual and
Planning must not gain mutation tools from free-form language.

In addition, PR #143 fixes global locale ownership in the Organization panel,
makes the Gameboard bilingual (English first, Swedish selectable), and removes
visible SEER/Nova personalities from the planning/strategy/execution labels.

## Pending legacy removal: do not bulk-delete

The root `src/` tree, historical service filenames, old config keys and
SQLite/HTTP compatibility contracts may have external users and tests. Deleting
them is a separate, reversible migration with the following requirements:
prove there are no build/runtime/packaging consumers, audit API/DB upgrade
paths and serialized data, add compatibility aliases where required, run all
CI and real Windows/Android host checks, then remove each proven-unused path.
Do not rewrite a mission log or drop real execution history to improve
source-code aesthetics.

## Acceptance

- Rendered English default and Swedish toggle persistence, including Gameboard
  and Organization panel, are covered by UI assertions.
- CI must pass production client, server, mission, contract, budget, restart and
  controlled Chromium desktop/mobile tests with no unsupported tool calls.
- A passing GitHub CI proves source/build acceptance, **not** that a running
  Windows/Termux host or a Marketplace extension was upgraded.
