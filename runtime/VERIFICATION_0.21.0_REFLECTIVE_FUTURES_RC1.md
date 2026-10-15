# Verification — JACO Cognitive Runtime 0.21.0 Reflective Futures RC1

## Classification

- Release candidate: YES, subject to post-ZIP verification
- Canonical activation: NO by default
- Physical Windows/Android/CDP: requires target-runtime proof
- Semantic TypeScript compile: separate dependency-sensitive verification; not inferred from parser checks

## Implemented invariants

- provider-neutral registry and capability/policy routing
- critical evidence referential integrity
- capability/reputation/load-aware multi-agent selection
- self-review bound to original worker
- peer-review excludes target worker
- independent evidence required for review rewards
- idle/stall detection
- deliberation with bounded time extension and `NO_CONCLUSION`
- reversible filesystem soft sandbox with deny-by-default network policy
- rolling 90-day versioned future window
- Brier forecast calibration
- synthetic scenario labeling
- A2A v1.0 trust registry and capability-aware inbound dispatch
- Continuum semantic MCP boundary with bearer requirement for remote mode

## Observed source-tree verification

`npm run test:release:021` completed successfully before release freeze:

- Reflective Futures static gate: 62/62 PASS
- Reflective Futures behavior: 14/14 PASS
- Continuum behavior: 11/11 PASS
- Continuum standalone/restart/integrity: PASS
- A2A Continuum boundary: PASS
- Truthful runtime: 15/15 PASS
- Frozen Hands-Off + SEER baseline: 49/49 PASS
- Connected E2E: 7/7 PASS
- Wi-Fi MCP contract: PASS
- Gateway WIP structural gate: 28/28 PASS
- Gateway semantic/security/SDK boundary tests: PASS
- Secret pattern scan: 0 hits
- Rollup native resolver: 6/6 PASS
- SQLite/CJS compatibility: 7/7 PASS

A final post-ZIP report is generated separately after manifest freeze, ZIP CRC, clean extraction, release-file hash verification, and rerunning `test:release:021` from the extracted artifact.

## Truth boundaries

1. Provider catalog entries are not availability evidence. Runtime probe/receipt determines availability.
2. The soft sandbox is not an OS/kernel isolation boundary.
3. Hidden agent intent is not inferred; only declared-goal/action/result consistency can be assessed.
4. Forecasts are probabilistic; synthetic scenarios never become observations solely because they were simulated.
5. Revenue/external outcome claims require appropriate verified evidence and are not implied by internal state transitions.
