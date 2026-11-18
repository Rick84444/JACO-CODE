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
