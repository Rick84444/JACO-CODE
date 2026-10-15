# JACO Cognitive Runtime 0.21.0 — Reflective Futures RC1

**Release ID:** `runtime`  
**Status:** RELEASE CANDIDATE — non-canonical until explicitly activated  
**Supersedes candidate:** `JACO-Cognitive-Runtime-0.20.0-CONTINUUM-RC1`

JACO 0.21 keeps the Continuum principle that **JACO owns continuity while models are replaceable reasoning providers**, then adds reflective multi-agent governance, reversible risk isolation, A2A trust/dispatch, and a rolling probabilistic futures window.

## Core architecture

```text
Operator / emergency stop
        |
Continuum Core :3020 (candidate)
  |-- Mission Ledger + Commitment Graph
  |-- Evidence Ledger with referential integrity
  |-- Runtime Hub + capability/reputation/load-aware dispatch
  |-- Provider Registry + policy/capability routing
  |-- Self Review + Peer Review + independently validated rewards
  |-- Deliberation Engine (time extension / NO_CONCLUSION allowed)
  |-- Risk Router -> reversible Soft Sandbox
  |-- Future Window (rolling 90 days, versioned forecasts, Brier calibration)
  |-- A2A Trust Registry + A2A v1.0 task routing
  |-- Economic Governor
  |-- Semantic Browser Runtime -> CDP :9222
        |
        +---- existing JACO execution substrate :3000 (optional)

Continuum Sentinel :3299
Continuum A2A      :3298
```

Candidate mode is intentionally sidecar-first. Activation ports remain `3000/2999/2998` and are not taken over without explicit activation.

## Provider policy

There is **no fixed Gemini, LM Studio, Ollama, OpenAI or other provider fallback chain**. Providers register with protocol, capabilities and policy metadata. Selection is based on observed health plus capability, reliability, latency, cost and privacy weights. Provider failure must return truthful `UNAVAILABLE`/failure evidence or cause policy-based failover; it may not synthesize a successful model answer.

Supported adapter families include Ollama, OpenAI Responses, OpenAI-compatible Chat Completions, Anthropic Messages and Google Generate Content. Additional compatible providers can be registered without changing SEER/agent logic.

## Reflective agent organization

- Productive work can schedule **self-review** bound to the original worker.
- **Peer-review** excludes the worker being reviewed.
- Rewards require independent verified evidence; agents cannot validate their own reward.
- Verified useful findings (real errors, code-quality defects, unjustified stalls, risks) can improve routing reputation.
- Duplicate criticism and false positives are penalized/neutralized to reduce reward hacking.
- Agents may explicitly remain uncertain; deliberation supports `TIME_EXTENDED`, `EVIDENCE_NEEDED`, `NO_CONCLUSION`, and `RESOLVED`.
- Hidden intent is **not inferred**. JACO compares declared goals/plans with observed actions/results and may flag inconsistency only.

## Soft sandbox

Risk does not automatically delete or disable an agent. JACO can move it to `SANDBOX_ONLY` with a real separate filesystem workspace, manifest hashes, snapshots and deny-by-default network policy. This is **filesystem/process-policy isolation, not an OS/kernel security boundary**.

## Rolling future window

Forecasts use a rolling 90-day horizon with version history. Real runtime observations can update probabilities over time. Resolved forecasts are scored with Brier loss and agent forecast weights can use historical calibration. Monte Carlo/scenario outputs are always labeled `synthetic:true` and never become evidence of real-world events by themselves.

## A2A

A2A v1.0 ingress routes tasks through RuntimeHub to capability-eligible agents; ingress acceptance is not completion. A persistent trust registry records Agent Card hashes and observed success/failure/dispute history. JACO-specific review, forecast and sandbox metadata are advertised as extensions, not changes to A2A core semantics.

## Quick verification

```bash
npm run test:release:021
```

The release gate covers 0.21 architecture, reflective behavior, Continuum restart/integrity, A2A, truth surfaces, Hands-Off/SEER regression, connected E2E, Wi-Fi MCP contracts, gateway security, secrets, platform Rollup resolution and SQLite/CJS compatibility.

## Candidate start

Windows:

```powershell
.\START_CONTINUUM_CANDIDATE_WINDOWS.cmd
```

Android / Termux:

```bash
chmod +x START_CONTINUUM_CANDIDATE_ANDROID_TERMUX.sh termux/*.sh bin/jaco-continuum
./START_CONTINUUM_CANDIDATE_ANDROID_TERMUX.sh
```

Expected candidate endpoints:

- Continuum Core: `http://127.0.0.1:3020`
- Continuum Sentinel: `http://127.0.0.1:3299`
- Continuum A2A: `http://127.0.0.1:3298`

## Truth boundaries

This RC does **not** claim physical Windows/Android/CDP verification for 0.21 unless a target-runtime proof is produced. Semantic TypeScript `tsc --noEmit` is a separate dependency-sensitive gate; syntax/parser success is not reported as semantic compile success. Historical 0.20 evidence files are retained only as inherited provenance and must not be read as 0.21 runtime proof.

See `VERIFICATION_0.21.0_REFLECTIVE_FUTURES_RC1.md`, `CURRENT_RELEASE.json`, and `docs/continuum/`.
