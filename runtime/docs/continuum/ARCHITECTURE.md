# JACO Continuum Architecture

```text
Operator / Kill Switch
        |
Cognitive Kernel
  | Mission Ledger ------ Mission Capsules
  | Commitment Graph ---- persistent obligations
  | Evidence Ledger ----- hash-linked event provenance
  | Execution Leases ---- bounded authority
  | Economic Governor --- hard cloud/financial budgets
        |
Persistent Scheduler ---- restart recovery / work queue
        |
Runtime Hub ------------- agents / messages / tasks / A2A
  |       |       |
Models   Skills   Browser Runtime
 |                 |
Ollama/OpenAI      Semantic Compiler -> Delta Engine -> Batch Executor -> CDP :9222
        |
Verification -> Capability Compiler -> Knowledge Objects -> Cognitive Compression
```

## Persistence
Continuum control-plane persistence is portable JSON + append-only JSONL with a SHA-256 chain. It deliberately has **no native SQLite requirement**. Existing JACO subsystems may use `node:sqlite` where available.

## Scheduling
The scheduler restores its persisted enabled state after process restart and recovers stale claimed tasks. It executes only an explicit allowlist of internal task kinds. Unknown/A2A inbound work remains in the Runtime Hub until an eligible agent claims it.

## State transitions
Missions default to operator final signoff. Commitments can be autonomously fulfilled only after execution evidence is recorded. A mission enters VERIFYING after all commitments are fulfilled and remains there for operator signoff unless the operator explicitly delegated final signoff for that mission.

## A2A
The A2A boundary publishes `/.well-known/agent-card.json` and accepts JSON-RPC at `/`. Non-loopback binding is refused without a bearer token. `SendMessage` queues bounded work; it never fabricates completion.
