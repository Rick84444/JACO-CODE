# Shared Cognitive Cycle ledger verifier

**Scope:** JACO-CODE cleanup following PR #42. No new model or privileged agent is introduced.

## Structural debt removed

Previously, the deterministic runner and the Aura IDE projection independently parsed and hashed the same append-only `events.jsonl` file. Their error handling, event caps and structural validation could drift. `agents/lib/cognitive-cycle-ledger.mjs` now owns only two pure, import-safe operations:

- `hashCycleEvent(event)`: original SHA-256 hash over JSON insertion-order serialized fields other than `hash`.
- `parseCycleLedger(text, opts)`: ordered sequence, preceding hash, canonical event schema, bounded size and event count, well-formed typed fields and a complete final newline.

The lab keeps its `CYCLE_LEDGER_TAMPERED` error contract and the IDE keeps `CYCLE_LEDGER_INTEGRITY_FAILED`. Both reject truncated or structurally forged records. The IDE continues to apply its tighter 8 MB / 2,000-event bounds. The runner refuses symlinked ledger files.

## Limits and cleanup boundaries

This is a **local integrity check**, not an externally anchored signature: anyone with privileged write access to the journal can rewrite the entire chain. Reviewer HMAC attestations remain separately checked in the lab. Neither the IDE nor the parser claims autonomous merge to GitHub.

Do **not** remove identically hashed `public/` and `runtime/public/` assets based solely on duplicate SHA. Their packaging and ownership must first be traced through root/runtime builds, installer manifests and Termux/Windows distribution tests.

## Verification

`node --test tests/cognitive-lab/*.test.mjs tests/nova/cognitive-capsule.test.mjs`

Tests cover valid replay, malformed JSON, incomplete tails, rehashed structural forgery, cross-reader consistency, size/event caps, and symlink refusal. The full deterministic 33-cycle development test remains part of the suite. GitHub CI and device UX acceptance are separate requirements.
