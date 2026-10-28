# JACO Cognitive Runtime — Atomic Agent hardening

Date: 2026-10-28
Status: [REAL] local source changes and executed regression tests; [PROTOTYPE] trust boundary; [UNKNOWN] Android/Termux, full provider and deployment integration.

## Scope / source

Reference project: https://github.com/AtomicBot-ai/atomic-agent at released tag v0.6.12.
Specific design references:
- https://github.com/AtomicBot-ai/atomic-agent/blob/v0.6.12/src/agent/policies/fusion-orchestrator-mode.ts
- https://github.com/AtomicBot-ai/atomic-agent/blob/v0.6.12/src/agent/loop-detector.ts
- https://github.com/AtomicBot-ai/atomic-agent/blob/v0.6.12/src/agent/progress/mutation-epochs.ts
- https://github.com/AtomicBot-ai/atomic-agent/blob/v0.6.12/src/agent/policies/claim-evidence.ts

No Atomic Agent code was copied; these are independently implemented JACO contracts.

## Code changes

1. `runtime/src/server/continuum/evidenceLedger.mjs`: untrusted `record()` always creates unverified evidence; `verify()` rejects caller-asserted proof. Trusted runtime components use explicit `recordInternal()` and `verifyInternal()` with an HMAC integrity tag over the entire saved record. Legacy unsigned `verified:true` evidence is interpreted as unverified upon read. The integrated REST routes are deliberately unchanged in shape, so older /verify callers now receive a denial.
2. Internal Continuum observers migrate to `recordInternal()`; this means observed **responses/events** are attested, not that the model's narrative conclusions are true. Privileged same-process modules remain within the trusted computing base.
3. `runtime/src/server/continuum/leaseManager.mjs`: `authorize()` and legacy `consume()` now require the bound `agentId` and `missionId` on every request, matching `beginAction()`.
4. `agents/lib/cognitive-evidence-authority.mjs`: independent child-process evidence recorded as exit status, stdout/stderr hash, exact code hash, harness hash, reviewer identity/capsule fingerprint, and a sealed HMAC attestation.
5. `agents/lib/cognitive-progress.mjs`: bounded progress policy, repeated-call refusal, evidence-driven score improvements, and no-improvement stop.
6. `agents/lib/cognitive-lab.mjs`: real Continuum lease authority used for each role, durable reviewer operation reservation, progress records, and signed evidence required before skill reuse.
7. `tests/cognitive-lab/atomic-hardening.test.mjs`: nine new negative and two-run tests; updated legacy Continuum tests and strict HTTP knowledge lifecycle test.

## Observed local results

- Cognitive Lab + Capsule + new hardening tests: **28/28 passed**.
- Continuum runtime-behavior: **19/19 passed**.
- Focused Continuum matrix: 11/13 scripts passed after adapting the knowledge lifecycle contract. `a2a-result-delivery` cannot load an absent dependency, and `a2a-outbound` timed out waiting for its child `/health`. Both failures also reproduce against the original working copy and were not introduced by this patch.
- Clean final simulation, same task as the previous Cognitive Lab: run 1 baseline 4/8, hardened 8/8; run 2 retrieved prior verified strategy, hardened 8/8 immediately. Source candidates remain prewritten templates; there were no autonomous LLM code synthesis steps.

## Trust and deployment limitations

- HMAC keys are stored as owner-restricted files in the **same OS account** as the runtime. This detects accidental/partial record edits, but is not a defense against arbitrary local code execution, compromised plugins, or a malicious agent with unrestricted filesystem access. A real high-assurance verifier must execute in an isolated process with separate OS principal and key custody. No capability remains secure if the untrusted agent can import and call internal `recordInternal()` or access the authority key.
- `recordInternal({verified:true})` verifies the provenance/integrity of an observation emitted by a trusted runtime component, not the truth of an arbitrary claim. Product semantics should distinguish *observed*, *tested*, and *independently verified* before broad promotion.
- Historical unsigned evidence intentionally ceases to authorize critical state transitions. Back up and develop a reviewed migration process; never blindly promote legacy `verified:true` to signed proof.
- `ExecutionLeaseManager` remains **single-writer** JSON storage, not a distributed transaction database. The reviewer subprocess is a test-runner boundary, not a hostile-code sandbox.
- Test metrics in this demo reflect one fixed HTTP retry task with two fixed candidates, not a general coding benchmark or independently reproduced Atomic Agent benchmark.
- No source was pushed to GitHub; no Termux services or external payments executed.

## Safe local replay

Run from an extracted working copy (NOT a running installation):

```bash
node --test tests/cognitive-lab/cognitive-lab.test.mjs tests/nova/cognitive-capsule.test.mjs tests/cognitive-lab/atomic-hardening.test.mjs
node runtime/scripts/continuum/runtime-behavior.test.mjs
node runtime/scripts/continuum/knowledge-lifecycle.test.mjs
node agents/cognitive-lab/run.mjs run --state /tmp/jaco-atomic-capsule-check
node agents/cognitive-lab/run.mjs run --state /tmp/jaco-atomic-capsule-check
node agents/cognitive-lab/run.mjs inspect --state /tmp/jaco-atomic-capsule-check
```

A production upgrade requires a branch, snapshot backup, a reviewed migration of evidence semantics, and an integration test against actual Termux/Android services and model providers. This package is a tested upgrade **candidate** rather than a deployed release.
