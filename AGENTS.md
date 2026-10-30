# JACO repository guide

This file is the repository contract for automated contributors.

## Product boundary

JACO is a local-first, model-agnostic runtime for persistent, policy-bound and verifiable agent execution.

Keep one canonical owner for each responsibility. Do not add a second planner, mission store, tool registry, browser controller, approval system, provider registry or UI when an existing subsystem can be extended.

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
3. Identify the subsystem that already owns the behavior.
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
- Remove obsolete implementations rather than keeping duplicate generations "just in case".
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
