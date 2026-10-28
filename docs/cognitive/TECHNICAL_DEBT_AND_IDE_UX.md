# Technical Debt Steward, IDE cycle history and green-to-main

## What is real

- `technical-debt-steward` is a separate capability-bound role in the deterministic 33-cycle lab. It reads and cleans the actual candidate source **before** the independent reviewer executes. The Senior gate checks the cleaned source hash against the reviewed hash. Unresolved blockers stop promotion; temporary candidate comments and mechanical whitespace are safely removed.
- The reviewer, developer and debt agent remain deterministic roles, **not three independently reasoning LLMs**. Safe cleanup does not guarantee production-wide technical debt has been removed.
- `GET /api/aura/workbench/autonomous-cycles` reads a bounded, hash-chain-checked ledger from `JACO_WORKSPACE_ROOT/.jaco/autonomous-cycles`, and returns a sanitized snapshot. It requires normal IDE authentication. It does not execute an agent, access arbitrary paths, or assert that a local Git commit landed on GitHub.
- The IDE agent board offers an `Autonom utveckling` read-only tab. A missing journal is shown explicitly; no mock data or manufactured online state is displayed. The local history is always marked `DETERMINISTIC_SIMULATION` and `HASH_CHAIN_ONLY`.

## GitHub green-to-main policy

Trusted default-branch workflow `Autonomous Green-to-Main` can merge **only** pull requests with same-repository branch prefix `feat/jaco-autonomous-`, targeting `main`, that are ready for review with no blocking `CHANGES_REQUESTED` review or hold label. Two always-running gates (`Autonomous Delivery Gate` and `Technical Debt Steward Gate`) are mandatory. **Every other PR workflow that actually ran for the exact current head SHA must also have concluded `success`**. Missing mandatory, pending, skipped or failed workflows prevent automatic merge. No PR code is executed with a write token in that workflow.

- Ordinary PRs and PRs with missing mandatory, pending, skipped or failed checks are NOT merged. Optional path-filtered workflows do not need to exist, but if they ran, they must pass. This is fail-closed for all checks applicable to the exact commit.
- On first introduction, the new auto-merge workflow is not active until committed on `main`. Updates to the workflow require separate review. The workflow will not merge the branch containing its own unreviewed change.
- A successful deterministic simulation is **not sufficient** to merge: GitHub must independently run the required checks.
- This is not GitHub branch protection, external signed review or production deployment proof. Set up branch protection/rulesets and real agent provenance for higher assurance.

## Development tests

`node --test tests/cognitive-lab/*.test.mjs tests/nova/cognitive-capsule.test.mjs`

`node agents/cognitive-lab/autonomous-cycles/run.mjs run --state .jaco/autonomous-cycles`

`node agents/cognitive-lab/autonomous-cycles/run.mjs inspect --state .jaco/autonomous-cycles`

No auto-start or network token required for these local tests. The `Technical Debt Steward Gate` additionally checks newly-added source lines on PRs and refuses unresolved markers; historical unrelated repository debt does not fail the gate.