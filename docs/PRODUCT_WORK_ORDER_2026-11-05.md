# JACO / Aura — product work order and adversarial verification, 2026-11-05

**Status:** OPEN — simulation and review gates must be observed before sign-off.
**Baseline:** `main` at `81cab00e5cb3c365bd946078a6cf3982bbd56baa` (merged PR #170).
**Owner of decisions:** JACO operator. **Change implementation:** bounded Git branch, no direct mutation of `main`.
**Scope of this revision:** inspect merged Claude work and Codex reviews; repair two independently traceable regressions; provide a backlog and falsifiable test contract. This document is not a release certificate.

## Product definition and architectural ownership

JACO is the runtime; **Aura is its single operator-facing agent**. The selected model is a replaceable provider, not a second agent authority. SEER/Nova references are historical filenames or internal services, not permission to create independently commanding personalities.

Canonical owner mapping from `AGENTS.md`:

| Responsibility | Canonical owner | Rule |
| --- | --- | --- |
| Planning and mission orchestration | `gateway/src/seer.mjs` (historical filename) | Rename only after all callers, startup scripts, tests and recovery paths migrate |
| Local executor and provider/mission adapter | `agents/hands-off-agent.mjs` | No alternate planner, tool authority or model fallback |
| Agent conversation and stuck detection | `agents/lib/agent-loop.mjs`, `agents/lib/stuck-detector.mjs` | Receipts and observed outcomes, not generated claims |
| Tools and discovery | `agents/lib/native-tools.mjs` | Advertise a function only when its caller actually supports it |
| Mission state and receipts | `runtime/src/server/connected/novaMissionControl.mjs`, `durableMissionBus.mjs` | Existing durable authority; avoid parallel ledgers |
| Tool/capability switches | `runtime/src/server/capabilities/capabilityPolicy.mjs` | Operator changes are authoritative; security invariants are not model-editable |
| UI | `runtime/src` | A single product UI; no second Vite or root `src` |

## Evidence already inspected

1. Claude's PR **#166** removed 59 obsolete files, including the unused root `src/` UI and `jaco/` Python package. PR **#170** merged this with PRs #165–#169. The current repository root no longer lists `src/` or `jaco/`. **Do not restore them casually.**
2. Codex PR **#166** review found the remaining `tests/test_state_integration.py` imports deleted `jaco.state` modules; the review reproduces `ModuleNotFoundError`. This is an **open regression**, not evidence of a working Python layer.
3. Codex PRs **#165/#170** found the fallback structured planner advertises `tool_search` without an execution exchange; this can become `INVALID_PLAN`. Source read confirmed the call from `agents/hands-off-agent.mjs`.
4. Codex PR **#165** found historical successful receipts reduced to the literal `'ok'` in `agents/lib/agent-loop.mjs`. Varying results were therefore counted as identical calls. Source read confirmed the implementation.
5. Codex PR **#170** found that `jaco_source` advertises `search` but `auraSourceInspector.mjs` only implements `status/list/read`; its read path rejects files larger than 32,768 bytes and truncates others at 16,000 characters without continuation. Source read confirmed both limits.
6. Independent inspection: `capabilityPolicy.mjs` treats a missing **or malformed** capability file as all tools enabled. Default-on is an explicit operator product choice, but **corruption must not silently erase previously disabled privileges**. Treat this as a security design decision requiring migration and recovery tests, not an unreviewed string replacement.

Source reviews: [#165](https://github.com/Rick84444/JACO-CODE/pull/165), [#166](https://github.com/Rick84444/JACO-CODE/pull/166), [#170](https://github.com/Rick84444/JACO-CODE/pull/170).

## Patch A — bounded changes in this review

**A1 — Outcome-sensitive restart recovery**
- File: `agents/lib/agent-loop.mjs`.
- Change: pass each historical receipt's actual `result` to the existing `StuckDetector` instead of replacing every successful result with `'ok'`.
- Falsifier: after three historical reads of the same resource returning different progress values, the resumed mission must **not** receive an inherited `STUCK:` warning. The unchanged-results cycle must still be detected.
- Regression: `tests/nova/agent-loop.test.mjs`.

**A2 — Unsupported discovery in structured planning**
- File: `agents/hands-off-agent.mjs`.
- Change: for the **structured fallback caller only**, disable catalog deferral with `deferAfterChars: Infinity`; the native agent loop still has deferred search. This avoids claiming an unavailable search exchange.
- Falsifier: an oversized catalog must never expose `tool_search` to a caller which only understands `planFromToolCalls`; direct `mcp__...` functions must remain selectable. Existing native-search behavior must remain unchanged.
- Regression: `tests/nova/native-tools.test.mjs`.
- **Follow-up risk:** this fallback may have a larger model request. Measure and bound catalog size with a caller-compatible solution before claiming cost optimization. Do not introduce a second tool registry.

## Product backlog — ordered by runtime consequence, not naming aesthetics

| ID | Priority | Work package | Acceptance evidence | State |
| --- | --- | --- | --- | --- |
| A1 | P1 | Preserve distinct historical results in the stuck detector | Changing vs identical receipts across restarts; focused test + CI | Implemented in branch; CI pending |
| A2 | P1 | Stop structured planner from advertising deferred search | Oversized catalog, structured and native negative/positive cases | Implemented in branch; CI pending |
| B1 | P1 | Reconcile deleted `jaco/` package with orphaned Python tests | No broken test discovery; retire only obsolete coverage with documented replacement invariant | OPEN |
| B2 | P1 | `jaco_source`: implement bounded safe search **or** remove the advertised action | Real call through Aura; blocked paths/symlinks/secrets; pagination | OPEN |
| B3 | P1 | `jaco_source`: bounded line-range/page reads for large implementation files | Inspect `runtime/server.ts` and `agents/hands-off-agent.mjs` without unbounded results or scope bypass | OPEN |
| B4 | P0 safety | Distinguish first-run default-on from corrupted capability-state recovery | Previous operator-disabled privilege remains disabled after damage or recovery fails closed, with explicit remediation | OPEN — needs policy migration review |
| B5 | P1 | Map aliases `SEER`, `Nova`, `Aura` by actual ownership rather than mass rename | Only Aura commands; all importers/tests/start scripts still work; historical state migrates | OPEN |
| B6 | P1 | Consolidate launch/provider/mission state in the installed Windows runtime | One selected provider; no unwanted Ollama spawn/fallback; restart/resume test on target | NOT TARGET-VERIFIED |
| B7 | P1 | Audit all independent control gates and overlapping MCP/CDP approval paths | One effective authority for each action; denial cannot be bypassed through alternate surface | OPEN |
| B8 | P2 | Remove obsolete docs and duplicate labels only after call-graph trace | No broken links, packages, Marketplace identifiers or migration state | OPEN |

## Senior debugging-agent adversarial review contract

The reviewer must **try to disprove** both patches; a self-review is not independent verification. Require:
- Compare exact patch against the baseline and inspect changed code **and callers**.
- Use a repeated-result case, a changing-result case and a malformed/absent historical-receipt case. Check false stuck alarms and false negatives; distinguish repeated polling from real progress.
- Test large connector catalogs in the native agent loop **and** structured fallback. Assert `tool_search` is never advertised to a caller unable to resolve it. Measure schema size; do not call unbounded prompts a durable fix.
- Confirm that approvals, credential handling, model routing and durable completion authority are unchanged.
- Look for unrelated/dirty files, duplicate implementations, deprecated names and green CI on a stale base SHA.
- Report defects as `CONFIRMED`, `HYPOTHESIS` or `NOT_VERIFIED` with a reproducer. **Critical/high findings block merge.**

## Simulation and release gates

The exact head commit must pass the following before **this scoped simulation** can be marked green:

1. `node --check agents/lib/agent-loop.mjs`
2. `node --check agents/hands-off-agent.mjs`
3. `node --test tests/nova/agent-loop.test.mjs tests/nova/native-tools.test.mjs`
4. `npm test` and affected GitHub CI gates for the exact PR head SHA.
5. Independent Codex/senior review on the final diff and resolution of blocking findings.

Required red/green scenarios:
- **S01** three changing historical results: no inherited `STUCK`.
- **S02** repeated identical historical results: inherited `STUCK`.
- **S03** native agent loop: deferred discovery is still callable.
- **S04** structured planner: catalog tools are callable without `tool_search`.
- **S05** abnormal/missing connector: proper blocker, no fabricated completion (existing contract; not revalidated by this patch).

**Exit rule:** Keep the simulation OPEN if a test fails, an exact-head CI gate is missing, or the independent review has unresolved high findings. Do not substitute a static code review for execution. Even when these tests pass, **Windows GUI, Chrome/CDP, Android, provider billing, Marketplace and autonomous end-to-end execution remain unverified** until observed on their targets.

## Reviewer handoff / product delivery

- Keep this PR separate from Claude's already merged cleanup; do not modify `main` directly.
- Fix any failing tests before considering merge; inspect CI logs, do not rerun blindly.
- Deliver an exact SHA, test commands/results, independent findings, evidence links, changed-file list, and a single prioritized next package from B1–B8.
- No release, deployment, branch force-push, spending or external-account mutation follows from this work order.
