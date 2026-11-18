# Experimental protocol
Question: can a presentation consumer suppress repeated notifications without affecting mission execution?
Baseline: every delivered event opens UI. Alternative: deduplicate stable event IDs in a session. Hypothesis: no repeated popup for the same ID, no missing unique ID under duplicate-only delivery.
Model: 1000 independent sessions, 20 events/session, independent 25% and 10% chances of two extra deliveries. Synthetic assumptions, not calibrated runtime observations.
Run from change directory: node --input-type=module -e "import {experiment} from './notification-model.mjs'; console.log(experiment(42)); console.log(experiment(73))"
Observed locally on Node 22.16.0:
seed | unique | deliveries | baseline duplicates | deduplicated duplicates | missed
42 | 20000 | 26892 | 6892 | 0 | 0
73 | 20000 | 26971 | 6971 | 0 | 0

This is a constructive sanity check, not evidence of real runtime reliability. The set stores all IDs until session completion; no persistence, reordered delivery, missing IDs, malformed input, reconnect or eviction is modeled. The next experiment must cover those cases and compare the production consumer, preserving authorization and mission state.
References:
- https://github.com/acmsigsoft/EmpiricalStandards/blob/master/docs/standards/EngineeringResearch.md
- https://design-science-research.de/en/publication/peffers-2007/
- https://doi.org/10.1007/s10664-020-09818-7
Environment limitation: local GitHub DNS resolution failed; Node 22 is below repository's stated Node 24 baseline. Full product build and target-device results remain unobserved.

## Bounded replay experiment
Node 22.16.0: node --test presentation.test.mjs — 6 passed, 0 failed. Source and tests committed separately. Further counterexample executed: advancePresentation(advancePresentation(null,['a','b','c'],true,2),['a','b','c'],true,2) returns fresh ['a']. An evicted ID can be replayed. This falsifies unrestricted exactly-once presentation with a finite ID set. Do not wire this experimental cursor to automatic audio/popup. Production requires a stable stream epoch and monotonic sequence/cursor, or an explicit bounded replay guarantee verified against the existing transport. Silent reconnect intentionally suppresses events delivered during disconnect; they must remain available in existing chat/approval surfaces. No claim of durable delivery or exactly-once mission execution.

## Measurement audit, 2026-11-18
The initial deduplicatedDuplicates counter was initialized to zero but never measured. The original result is superseded by the revised experiment with independently counted consumer outputs. A separate oracle measures duplicate, missing and unexpected IDs. Negative controls (pass-through, empty and fabricated output) demonstrate sensitivity to failure.
Node 22.16.0; local copies of files matched Git blob hashes:
- notification-model.mjs: 155d2aca4158b49ff085817baade6a1734e0ffaf
- notification-model.test.mjs: 33c09a482688ff7bba132adc179d24ba9124a87e
- runtime/src/lib/terminalText.mjs: 20179adf14a544f6bc1ffe5e3d9d745e201e7b5f
- runtime/src/lib/terminalText.test.mjs: bea16418cff2ba1190e7f39868e650a271943ec9

Reproduce from repo root: node --test openspec/changes/add-interactive-avatar/notification-model.test.mjs runtime/src/lib/terminalText.test.mjs
Observed on matching local files: 10 passed, 0 failed; exit 0. Synthetic test only, separate from production build.
Seeds | unique | deliveries | baseline duplicates | observed duplicates | missing | unexpected
42 | 20000 | 26892 | 6892 | 0 | 0 | 0
73 | 20000 | 26971 | 6971 | 0 | 0 | 0
0 | 20000 | 26827 | 6827 | 0 | 0 | 0
4294967295 | 20000 | 26971 | 6971 | 0 | 0 | 0

These are exploratory runs on generated inputs with no loss or restart. Seeds are not independent real-world samples; no generalization or production reliability claim follows. No product integration or target hardware test performed. npm ping fails EAI_AGAIN and git ls-remote fails DNS in this local environment; Node 24 build remains outstanding.
