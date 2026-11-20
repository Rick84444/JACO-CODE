# JACO repository guide

This file is the repository contract for automated contributors.

## Product boundary

JACO is a local-first, model-agnostic runtime for persistent, policy-bound and verifiable agent execution.

Keep one canonical owner for each responsibility. Do not add a second planner, mission store, tool registry, browser controller, approval system, provider registry, relay or UI when an existing subsystem can be extended.

**Mandatory deduplication gate:** before writing a feature, search the entire repository, tests, Skills, OpenSpec changes and `legacy/` for implementations with the same purpose, including different names. Compare functionality, safety, test evidence, maintainability and currency; choose one canonical owner (not necessarily the newest). Extend it rather than building another variant. Audit callers, preserve state and migrate; once verified, disable the replaced startup path and move retired historic code to `legacy/` or delete it. Do not move active imported files. Record the choice, alternatives, migration and legacy retirement in the change spec. The canonical customer Relay is JACO Link; see `docs/architecture/CANONICAL_RELAY_AND_DEDUPLICATION.md`.

Current implementation owners:

- `gateway/src/seer.mjs` — planning and mission orchestration. The filename is historical; treat it as the planner service, not as a separate product persona.
- `gateway/src/workplace/` — optional multi-process coordination.
- `agents/hands-off-agent.mjs` — local execution compatibility surface.
- `agents/lib/coding-contract.mjs` + `agents/lib/coding-workspace.mjs` — bounded repository mutation.
- `runtime/` — canonical product runtime, including Aura and its cognitive runtime integration.

Historical component names are implementation details. New files and APIs should use responsibility-based names.

## Before changing code

1. Inspect the current branch and preserve unrelated work.
2. Trace callers and tests before deleting or renaming anything.
3. Identify the subsystem that already owns the behavior and document every overlapping implementation before building anything new.
4. Define an observable acceptance condition and a falsifier.
5. Check whether the change touches secrets, external mutation, deployment, spend or protected policy.
6. Prefer the smallest coherent production change over a parallel abstraction.

If the coordination service is actually available, synchronize before competing shared mutations. If it is unavailable, do not invent synchronization; Git and CI remain the repository source of truth.

## Engineering rules

- No fabricated success, fake runtime state or placeholder production behavior.
- Do not claim a build, test, deployment or target-host result unless it was observed.
- Unknown execution outcomes fail closed and must not be repeated blindly.
- Durable mission/evidence state must survive restart where persistence is claimed.
- Outgoing payments and new financial commitments require explicit operator approval.
- Secrets belong in environment/credential stores, never source, logs, prompts, fixtures or committed examples.
- Public configuration must not contain operator-specific account IDs, private network addresses, personal endpoints or credentials.
- Generated files, runtime databases, caches, screenshots and local state stay out of Git.
- Remove obsolete implementations rather than keeping duplicate generations "just in case". Keep transitional compatibility only with a named owner, explicit opt-in, an observed migration dependency and a removal condition.
- New names should describe responsibility rather than an invented agent persona.

## Verification

For every material change:

1. Run syntax/type checks for changed executable files.
2. Run the narrowest relevant regression tests.
3. Run the affected repository CI gates.
4. Add a regression test for a reproduced bug when practical.
5. Distinguish source inspection, unit/integration verification and target-host verification.

A green unit test is not proof of Android, Windows, browser, external-provider, deployment or payment behavior.

## Repository hygiene

The public repository should contain only the product, tests, documentation and development tooling required to build and verify it. Remove:

- historical release snapshots and WIP reports;
- scratch workers and generated prototypes;
- duplicate UI/server generations;
- marketing/launch automation that is not part of the product;
- operator-specific configuration;
- obsolete personified agent surfaces that do not own a current capability.

Keep root-level documentation minimal. Detailed architecture belongs under `docs/`.

## Git behavior

- Keep commits coherent and scoped.
- Do not force-push protected branches or bypass required checks.
- Do not overwrite another contributor's unrelated edits.
- Merge only from a branch whose relevant CI is green.
- A merge is not runtime verification.

## Completion reporting

State exactly:

- what changed;
- what was removed or consolidated;
- which checks actually ran and their results;
- what remains unobserved.

## Spec-driven workflow (OpenSpec)

Non-trivial behavior changes start as an OpenSpec change under `openspec/changes/<change-id>/` (proposal, design, tasks, spec deltas) before code. See `openspec/project.md`. Tasks are ticked only on observed evidence; merge only from a branch with green CI; archive the change after merge.

## Research-driven engineering
For substantial architectural changes, record the research question, competing hypotheses, prior work (including upstream revision and license), baseline, falsifiers, experimental budget and acceptance thresholds before implementation. Use ACM SIGSOFT Engineering Research empirical standards and Peffers et al. DSRM as methodological references, not claims of academic endorsement. Prefer paired experiments, fixed seeds, held-out scenarios and ablations; distinguish simulation from production observations. Record negative results, uncertainty, confounders and reproduction commands. Review security, architecture, usability and empirical validity independently where possible; model-generated specialist perspectives are not independent peer review. Continue unblocked work within authorized scope, but preserve existing CI and operator boundaries. See the change-specific research protocol under OpenSpec.

### Research and product quality acceptance
These are engineering/release criteria, not additional runtime permission gates. A research claim and a production capability are distinct deliverables.
- Define the scientific contribution and null hypothesis, primary outcome, relevant baseline, resource budget and decision rule before evaluation. Report failed hypotheses and changes to the protocol. Treat exploratory results as exploratory.
- Measure externally observable outcomes through an oracle independent of the implementation under test. Include negative controls that demonstrate the evaluator detects broken implementations, not merely tests that prove assumptions by construction.
- Separate deterministic invariants from empirical estimates. Report sample sizes, seeds, distributions, uncertainty and relevant confounders. Compare on matched tasks, models, resources and configurations; reserve held-out tasks where generalization is claimed.
- Preserve reproducibility: exact source revision or file hashes, upstream license and version, environment, configuration, runnable command, actual exit status and traceable results. Never label a reconstructed calculation, mock or generated output as a measured production result.
- For cognitive capabilities, test transfer to unseen tasks, harmful memory retrieval, contradictory evidence, fault recovery and model substitution; distinguish retrieval/reflection improvements from training or weight changes.
- For interactive capabilities, test real hardware/browser compatibility, accessibility, failure isolation, responsiveness and resource contention with active missions. A screenshot, HTML mock or successful dependency download does not establish these properties.
- No placeholder implementation, silent fallback advertised as success, incompatible license, or unverified security/authority expansion may enter a production release. Reuse existing mature components with documented provenance and test the integration rather than treating upstream success as proof.
- Review relevant design alternatives for complexity, latency, maintainability and resource cost. Prefer simple implementations when they meet the same verified requirements; complexity is not a proxy for scientific quality.
- Before release, verify the exact candidate revision with affected CI, independent regression checks and target environment evidence for the claims being made. Keep unvalidated work on a development branch. Record remaining limits explicitly; do not claim academic endorsement, independent peer review or doctoral status.
