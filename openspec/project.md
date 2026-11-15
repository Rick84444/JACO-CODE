# JACO project context for OpenSpec

JACO is a local-first, model-agnostic runtime for persistent, policy-bound and verifiable agent execution. `AGENTS.md` is the repository contract; this file adds spec-driven workflow context.

## Layout
- `openspec/specs/<capability>/spec.md` - current truth (what is built and verified).
- `openspec/changes/<change-id>/` - proposals not yet merged: `proposal.md`, `design.md`, `tasks.md`, `specs/<capability>/spec.md` (ADDED / MODIFIED / REMOVED requirements).
- `openspec/changes/archive/` - merged changes, moved here after the deltas are applied to `specs/`.

## Conventions
- Change ids are kebab-case and verb-led (`add-...`, `fix-...`, `harden-...`).
- Every requirement is `### Requirement: ...` with normative SHALL/MUST text and at least one `#### Scenario:` using `- **WHEN**` / `- **THEN**`.
- Owners: planner `gateway/src/seer.mjs`, runtime `runtime/`, local execution `agents/`. Do not add a parallel owner.

## Workflow
1. Propose: write the change folder on a branch `spec/<change-id>`; define an observable acceptance condition and a falsifier.
2. Implement: work through `tasks.md`, tick items only when observed. Add regression tests.
3. Verify: run the narrow tests, then CI on the exact SHA. Separate source inspection, unit tests and target-host proof.
4. Review: independent review (`/code-review`) before merge.
5. Archive: after merge, apply the deltas to `openspec/specs/` and move the change to `archive/`.

## Safety
Payments, external mutation, secrets, deployment and protected policy always need explicit operator approval. Unknown outcomes fail closed.
