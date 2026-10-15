# Repository hygiene review

Review date: 2026-09-23. Scope: safe repository hygiene, not a runtime certification.

## Observed baseline

[REAL] Inspected local `master` at `d57cd5596664a34d62cdb597eaa70e0ed01d58dd`, with 839 tracked files. Other agents may advance this shared checkout after this observation.

[REAL] The nested `runtime/` directory is an active runtime substrate, as documented in the root README and referenced by the package manifest. Its historical name does not justify removing it.

[REAL] Existing dirty `agent-hub-data.json`, untracked `agents/workflows/`, diagnostic scripts and JSON outputs were left untouched. Their ownership and retention requirements are not established by this review.

## Implemented safe cleanup

[REAL] Root ignore rules now cover `.env.*` variants, including production, backup and local suffixes, at every depth. `.env.example` and `.env.*.example` remain eligible for source control. The redundant `*.log` entry was removed; effective log exclusion is unchanged.

[RISK] Ignore rules are not a secret scanner and do not remove already tracked content or Git history. Example files must contain placeholders only. No secret values were inspected or included in this review.

## Startup and test ownership

[REAL] Root package scripts distinguish `start` (hands-off agent), `seer`, `workplace` and `dev` (Vite). They are not interchangeable full-stack startup commands. `agents/start-all.ps1` is the stack orchestration script under active startup review; this document does not authorize running it or exposing services.

[REAL] The nested runtime retains Windows, Termux and isolated Continuum candidate launchers. These are different execution targets, not proven duplicates. Consolidation requires tracing callers and preserving platform-specific contracts first.

[REAL] Root `npm test` targets `tests/nova/*.test.mjs`; Workplace has its own `test:workplace` script. `test:self-development` selects two integration files under `gateway/test/`, not every SEER test. A passing individual suite must not be reported as complete repository or physical Android verification.

## Deferred changes and evidence required

1. [RISK] `src/App.tsx.bak`, `src/index.css.bak` and `src/main.tsx.bak` are tracked backup files. Check import/build references and operator retention intent before removing or archiving them. None were deleted.
2. [RISK] Global `*.png` exclusion can hide future legitimate image assets. Inventory actual screenshot locations and asset callers before replacing it with directory-scoped rules. No asset rule changed here.
3. [UNKNOWN] Untracked diagnostic JSON files may contain runtime state. Their content, provenance and retention need owner review before staging, ignoring, moving or deleting. No blanket JSON/scratch-file ignore was added.
4. [SPEC] Add a canonical startup guide that names each runtime owner, configuration source, prerequisites, health contract and safe restart boundary once the concurrent startup review is verified. Link old entry guides to that owner rather than creating another launcher.
5. [SPEC] Introduce a repeatable ignore-policy check and secret scanning in CI as a separately reviewed change. Do not mistake filename protection for proof of clean history.

## Verification and limits

[REAL] Verification uses `git check-ignore --no-index` with synthetic path names, tracked-file enumeration and `git diff --check`. No generated file, credential, agent state, dependency or runtime process was deleted or changed by this hygiene slice. No runtime tests were needed for the ignore/documentation-only change; startup and Android functionality remain outside its proof.
