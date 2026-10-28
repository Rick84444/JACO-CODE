# JACO Cognitive Lab v2 — three-agent executable simulation

## Reality classification

- **[REAL]** 3 separately scoped Cognitive Capsule folders exist on disk. Every active transition checks the tool intersection using the existing `loadCognitiveCapsule` / `assertCognitiveCapsuleTask` contract.
- **[REAL]** Developer code candidates are real ESM implementations. The reviewer runs eight independent acceptance scenarios against a real local HTTP server on 127.0.0.1 from a child Node process. Results come from observed HTTP responses and request counters.
- **[REAL]** Persistent journal uses a SHA-256 hash chain; completed review reports and code hashes are bound to promoted knowledge. Missing/modified reviewer evidence invalidates earlier knowledge. A second invocation retrieves this prior knowledge and reduces candidate attempts from two to one in this controlled case.
- **[SIMULATED]** The *agent decisions* and candidate generation are deterministic. `prompts/IDENTITY.md` files describe intended future roles, but no LLM interprets them in this demonstration. Neither open-ended reasoning nor autonomous code generation is claimed.
- **[NOT VERIFIED]** Real model provider integration, Termux production stability, CI integration, hardware/Android/CDP actuators, third-party plugin execution, network egress policy, crash recovery in the middle of a write, multi-node coordination and genuine long-horizon behavior.

## Run (from JACO-CODE repo root)

Prerequisite: Node.js >=22 and the v1 Cognitive Capsule module installed (`agents/lib/cognitive-capsule.mjs` is included in this delivery). Existing `agents/lib/agent-home.mjs`, `secret-capture.mjs` and `secret-store.mjs` remain unmodified.

```bash
node agents/cognitive-lab/run.mjs run --state .jaco/cognitive-lab
node agents/cognitive-lab/run.mjs run --state .jaco/cognitive-lab
node agents/cognitive-lab/run.mjs inspect --state .jaco/cognitive-lab
node --test tests/cognitive-lab/cognitive-lab.test.mjs tests/nova/cognitive-capsule.test.mjs
```

First invocation: `baseline 4/8 FAIL` then `hardened 8/8 PASS`. Second invocation with the same state: `hardened 8/8 PASS` on the first attempt. This is **fixed-domain evidence-guided strategy selection**, not general improvement of model weights.

For a clean-room reset, use a *new* state directory instead of deleting production memories.

## What is in each agent's folder?

```text
<state>/
├── agents/
│   ├── user-agent/
│   │   ├── capsule.json
│   │   ├── prompts/IDENTITY.md
│   │   ├── AGENTS.md  SOUL.md  USER.md  MEMORY.md
│   │   └── memory/
│   ├── developer-agent/
│   │   ├── capsule.json
│   │   ├── prompts/IDENTITY.md
│   │   ├── skills/http-retry/SKILL.md   # promoted only after review
│   │   └── memory/YYYY-MM-DD.md
│   └── reviewer-agent/
│       ├── capsule.json
│       ├── prompts/IDENTITY.md
│       └── memory/YYYY-MM-DD.md
├── evidence/<run-id>-<candidate-number>.json
├── ledger.jsonl                    # hash-linked operation journal
└── latest-report.json
```

**Tool boundaries:** User can create the mission and criteria; Developer can query reviewed memory, propose a template and request a test; Reviewer can inspect, test, publish evidence and promote a skill. No agent can grant itself additional privileges. State identity and prompt content are bound by capsule fingerprint. The agent notes and skill metadata are lower trust than the runtime's mission policy.

## Threat model and remaining work

1. The SHA-256 chain is corruption-evident for individual edits but **not a cryptographic signature**. Privileged local actors can rewrite all events and hashes or delete a valid journal suffix. For production use an external signed checkpoint (e.g. HMAC with secret outside the state dir), transaction storage, and immutable off-host audit shipping.
2. This is a **single-process single-writer** demo. The directory lock fails closed after a crash; it intentionally does not auto-remove stale locks. Do not permit distributed shared state without DB transactions and fencing tokens.
3. Review executes only two hardcoded locally trusted source templates. It is **not a security sandbox for model-generated code**. General-purpose arbitrary code needs a locked-down unprivileged container / VM with network off, resource limits and a separate verifier.
4. Eight passing tests are evidence of eight behavioral constraints, not mathematical correctness. New edge cases and property/fuzz testing should follow.
5. Prompt content is loaded/fingerprinted but is not interpreted by the deterministic agents. Model decisions, when added, must be regarded as untrusted proposals. Reviewer must always use non-model-generated tests and reproducible artifacts.
6. This opt-in lab does not take over existing JACO agent runtime, external browsers, Termux services or GitHub. Production integration should proceed through scoped branches and CI gates.

## Next engineering stages

1. Add a real local Ollama/LM Studio model provider that can *propose* changes in a disposable worktree, without granting test/result authority.
2. Run independent tests, property-based checking, mutation testing, security checks and benchmarks in sandboxed workers.
3. Implement signed evidence, durable lease reservations, idempotent side-effect receipts, crash resume and deterministic replay.
4. Run repeated unseen coding missions and compare first-pass acceptance, cumulative repair work, regression rate, actual cost and recovery. Promote knowledge only if holdout benchmarks improve.
