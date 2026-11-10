# Aura autonomous runtime — evidence audit and release gate (2026-11-10)

## Status and scope

[REAL] Source inspection and automated tests of the canonical JACO runtime.
[UNKNOWN] Unattended goal-to-repair on the operator's installed Windows PC using the selected real LLM and live tools.
[NOT DONE] Production-grade adaptive autonomous agent certified across varied tasks.

**One primary agent remains Aura.** Historic SEER/Nova names are service and adapter filenames, not new principal agent identities. This change does not add an agent, policy manager, skill registry, planner, UI or memory database.

## Evidence from external systems

- OpenHands SDK ([source](https://github.com/OpenHands/software-agent-sdk)) uses an agent reasoning-action loop with tools, conversation state, typed events and workspaces. The UI does not execute agent actions.
- SWE-agent ([ACI design](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md)) treats the tool/computer interface as part of agent performance: targeted file viewing, precise search, edit validation, recorded trajectories.
- OpenAI Codex ([app-server](https://github.com/openai/codex/tree/main/codex-rs/app-server)) has durable threads/turns, tool item lifecycle and explicit execution state.
- Anthropic's [long-running harness primitives](https://github.com/anthropics/cwc-long-running-agents) use default-fail completion criteria, a fresh-context evaluator without write access, and a resumable handoff. It describes patterns, not a turnkey product.
- Aleph One's [production coding-agent case study](https://www.aleph1.io/work/autonomous-coding-agent) self-reports 518 sandbox runs, 88 PRs and 57 merges over three months, with version-controlled context and a separate verification harness. These are vendor-reported case-study figures, not independent outcomes for JACO.
- Reddit field reports ([LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/comments/1u6mmuu/local_coding_agents_are_good_now_but_only_if_you/), [AI_Agents](https://www.reddit.com/r/AI_Agents/comments/1t09uei/lessons_learned_building_agents_in_production/), [ClaudeCode](https://www.reddit.com/r/ClaudeCode/comments/1thkqxp/i_built_an_e2e_validation_harness_that_claude/)) discuss fragile long loops, context drift and the need to test real browser/app state. Anecdotal, not accuracy statistics.

## Actual JACO owner map

| Behavior | Owner | Evidence and limits |
| --- | --- | --- |
| Think/select/act/observe | `agents/lib/agent-loop.mjs` | Native model function calls, bounded turns, no-tool recovery and receipts |
| Admission/steps | `runtime/src/server/connected/novaMissionControl.mjs` | Durable lease, task validation, begin/finish, operator blocks |
| History | `durableMissionBus.mjs` and mission receipts | Up to 40 persisted receipts; replay state not a model memory proof |
| Stuck detection | `agents/lib/stuck-detector.mjs` | Detects repeat, ping-pong, recurring calls; this PR fixes cross-run identity |
| Context compression | `agents/lib/condenser.mjs` | Bounded, deterministic summaries; retained logs not proof of equivalent semantic context |
| Prior experience | `verified-outcome-context.mjs` and `KnowledgeStore` | Verified-only relevance hints; stale revision is labelled |
| Verification | Mission coding contracts, `EvidenceLedger`, `OutcomeKnowledgeCompiler` | In-process attestations are not independent OS isolation |
| Control plane | `docs/architecture/aura-control-plane-migration-2026-11-09.md` | Aura owns orchestration lease but migration of remaining compatibility processes is incomplete |

## Reproduced defect and repair

The runtime persists `inputHash = sha256(stableJson(action.data))` in receipts. Previously, `runAgentMission` rehydrated the StuckDetector by SHA-1-hashing that saved hexadecimal string, while new calls were SHA-1-hashed from raw JSON arguments. Both inputs represented the same action, but produced different keys. MCP history further used `mcp-call` / `mcp-write` whereas live calls used `server.tool`.

Repairs:
1. Use the same canonical SHA-256 action hash for durable receipts and *the validated, begun action* in the live loop.
2. Normalize historic/live MCP identities to `server.tool` when its original server and tool names are present.
3. Preserve fallback for non-durable callers, keep argument-sensitivity and result-sensitivity, and do not retry state-changing actions automatically.
4. Reproduce the case through real mission SQLite/control fixtures and a scripted model, asserting that the model receives a STUCK correction and selects a different action.

## Adversarial senior review — simulated, not an external person

Perspective: a commercial production engineer who rejects unmeasured ROI and model-written "done" claims.

Round 1 — **reject** a patch that hashes saved digests again; it cannot relate the historical action to the current call. **Fix:** canonical hash.

Round 2 — **reject** comparing only tool task types: MCP uses `mcp-call` in durable storage but `server.tool` in the live loop. **Fix:** normalize identity.

Round 3 — **reject** calculating new identity from the model's *proposed* arguments; the executor may normalize them during `begin`. **Fix:** hash `begun.data`, exactly what the authoritative runtime persisted.

Round 4 — **reject** a claim that a scripted-model regression proves unattended real-world agent performance. **Gate:** an independent evaluation on the installed runtime using actual tools, fresh untrained tasks and ground-truth outcomes.

## Certification before a claim of production-ready autonomy

1. Run the exact selected LLM on the real installed Windows runtime, not a scripted model.
2. Freeze source SHA, provider/model, mission contract and tool set for each evaluation.
3. Use at least 20 varied, previously unseen repo tasks: bugs, new functionality, web/CDP flows, tests and interrupted/failed tools. Record attempts and cost per task.
4. Compute *independently verified success*: source diff, after-change tests, no regressions and operation evidence, not model answer or UI animation.
5. Inject restart between tool result and next model turn, loss of SSE, provider unavailability, duplicate result, denied tool, and ambiguous external effect.
6. Re-run identical tests with adaptive knowledge hints disabled/enabled to **measure** whether cognitive retrieval improves outcomes rather than presuming it does.
7. Require no false success claims, no unauthorized mutations, and no silent auto-repeat of uncertain external effects.
8. Publish the real numerator/denominator, blocker codes, retries, model cost and remaining failures. Only then assign a performance tier.

The corrected cross-run stuck detection is **a bounded production repair**, not a certification of JACO as a self-improving business or app-building agent. A model or simulated expert cannot independently attest a deployment.
