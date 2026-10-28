# JACO – Autonomous Development Cycles (33-cycle lab)

**Date:** 2026-10-28. **Basis:** JACO-CODE cognitive hardening candidate and the source integrated in GitHub Draft PR #41 (`83f70a7d842e3e90b9b72ec0c5d7bba0fd4d3abe`).

## Outcome

- [REAL] 33 local development cycles, resumed across three distinct invocations, with a separate Node.js reviewer process on each cycle.
- [REAL] 11 intentionally flawed hypotheses rejected after actual test failures; the debugger recorded the failed cases and the senior reviewer gate blocked merging.
- [REAL] 11 repaired candidates passed their increasing cumulative test suites and were committed. Eleven post-repair regression cycles also passed.
- [REAL] 452 total behavioral test-case executions: 433 passed, 19 failed on rejected candidates. Final cycle: 28/28 passed.
- [REAL] Twelve local Git commits including the base commit. Local Git repository history can be examined from `evidence/task-engine-history.bundle`.
- [REAL] The controller persisted 220 hash-linked events; 33 reviewer results were HMAC-attested locally, and 11 versioned knowledge entries were promoted with code and commit hashes.
- [REAL] Seven fresh supervisor/system tests passed; pre-existing JACO regression suites also passed: 28/28 agent/capsule/hardening and 19/19 Continuum behavior.
- [SIMULATED] User Agent, Git Researcher, Developer, Autonomous Developer, Debugger, Reviewer and Senior Developer are distinct *rule-governed roles*, not seven independent LLM processes. Candidate source is a deterministic feature-gated task engine, not novel code synthesized by an LLM.
- [LIMITATION] A test reviewer subprocess is not an OS sandbox. Same-account HMAC and an unsigned hash-linked journal do not guarantee integrity against an attacker with arbitrary local filesystem access. No real paid/cloud actions were used.

## Development milestones

| Goal | Faulty candidate | Accepted repair | Regression | Test cases at repaired stage |
| --- | --- | --- | --- | --- |
| Validation | 0/2 | 2/2 | 2/2 | 2 |
| Idempotency | 3/4 | 4/4 | 4/4 | 4 |
| Retry | 5/7 | 7/7 | 7/7 | 7 |
| Abort | 7/9 | 9/9 | 9/9 | 9 |
| Persistence | 10/11 | 11/11 | 11/11 | 11 |
| Fencing | 12/13 | 13/13 | 13/13 | 13 |
| Permissions | 13/16 | 16/16 | 16/16 | 16 |
| Receipts | 17/18 | 18/18 | 18/18 | 18 |
| Cross-agent isolation | 18/21 | 21/21 | 21/21 | 21 |
| Budget across restart | 22/23 | 23/23 | 23/23 | 23 |
| Concurrent duplicate prevention | 24/26 | 26/26 | 28/28 | 26 + 2 final holdout checks |

## Important observations

**Cross-agent replay.** An independent check of the pre-fix TaskEngine showed two different missions using the same task ID receiving the same result, with only one effect. The repair made the idempotency key include agent identity, mission and task ID, and rejects a conflicting HTTP method.

**Budget resets.** A new TaskEngine restored from an old snapshot previously reset its call budget to zero. The repair persists `calls` and rehydrates it, preventing the second operation when `maxCalls: 1` has already been exhausted.

**Concurrent duplicates.** Two simultaneous same-ID operations previously both executed before either could update the cache. The repair introduced in-flight single-flight deduplication for equal scoped jobs, while rejecting method collisions. It only works within one TaskEngine process, **not across separate processes, devices or a distributed cluster**.

## Role/lease controls

The seven roles have separate read-only capsule policies (JSON with role ID and declared capabilities). The runtime uses the actual JACO Continuum `ExecutionLeaseManager` to bind each role to the current cycle and restrict actions. Reviewer subprocess work uses a durable `beginAction` reservation and `finishAction` receipt. Failed reviews are not promoted; senior review is an enforced gate in the deterministic orchestration.

## Reproducibility

Unpack the *upgrade-only* archive into a separate checkout of JACO-CODE that already contains PR #41, preserving its directory paths. Do not overwrite a running Termux install. On Node.js 22+ with Git available:

```sh
node --test tests/cognitive-lab/autonomous-cycles.test.mjs
node agents/cognitive-lab/autonomous-cycles/run.mjs run --state /tmp/jaco-autonomous-cycles --until 11
node agents/cognitive-lab/autonomous-cycles/run.mjs run --state /tmp/jaco-autonomous-cycles --until 22
node agents/cognitive-lab/autonomous-cycles/run.mjs run --state /tmp/jaco-autonomous-cycles --until 33
node agents/cognitive-lab/autonomous-cycles/run.mjs inspect --state /tmp/jaco-autonomous-cycles
node agents/cognitive-lab/autonomous-cycles/run.mjs adversarial --state /tmp/jaco-autonomous-cycles
```

The reviewer reports and event log in this deliverable are *illustrative execution evidence*. The local HMAC authority key was deliberately **not included**, so detached copies cannot independently reverify historical MACs. The on-disk controller can verify its own live state or the user can rerun the simulation to generate new keys and evidence. A full independent supply-chain/signature scheme would be required for externally auditable claims.

## Required next steps before production use

1. Replace deterministic candidate selection with actual model-driven Developer and Debugger policies, under strict tool/capability boundaries.
2. Move evidence authority and execution signing keys to an isolated reviewer identity/process with hardened sandboxing.
3. Replace single-process single-flight and JSON lease storage with transactional operations, idempotency tokens, and fencing enforced at external actuators.
4. Add crash injection between reservation and side effects, distributed-worker tests, prompt injection scenarios and previously unseen coding tasks.
5. Integrate only after full CI and Termux testing; no changes to GitHub `main` were made by this simulation.

**Git:** https://github.com/Rick84444/JACO-CODE/pull/41
