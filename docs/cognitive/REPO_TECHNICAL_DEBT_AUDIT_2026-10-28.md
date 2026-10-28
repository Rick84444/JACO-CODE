# JACO-CODE technical debt, integration and IDE-UX audit — 2026-10-28

Status: evidence-based, targeted follow-up to PR #42. This report is **not** a claim that the whole repository is debt-free.

## Findings

1. **Autonomous merge trust boundary — high priority, repaired in this change.** The merge workflow formerly relied on green checks but did not refuse PRs that modified the CI / security machinery responsible for green checks. It now ignores non-PR workflow runs, reads all changed filenames, and blocks automatic merge if a PR changes GitHub workflows, the debt checker, the automerge-policy test, the evidence authority, the Continuum evidence ledger or the execution lease manager. Those PRs need explicit human review. See the executable policy tests.
2. **IDE progress staleness — UX defect, repaired.** The autonomous development panel previously fetched its journal only once on mount. While a 33-cycle simulation ran, the user had to reload manually to see progress. It now polls every five seconds when the tab is visible, clears pending work when unmounted, and retains manual refresh. An API error is displayed as an error, not as proof of live execution.
3. **Repo mirror duplication — catalogued; deletion withheld.** GitHub's recursive tree for main at `b9365111fdc1d4cadd125f7277ede3eb65c8f615` included 19 exact-blob duplicate groups (minimum 200 bytes). Fifteen groups mirror files between `public/` and `runtime/public/` (branding, docs, web metadata, evidence); another four groups are duplicated shell/source files (`runtime/scripts/kill_termux_zombies.sh` vs `scripts/kill_termux_zombies.sh`, `runtime/src/main.tsx` vs `src/main.tsx`, `runtime/src/utils/math.ts` vs `src/utils/math.ts`, and `runtime/start.sh` vs `start.sh`). **None can safely be declared unused from SHA equality alone.** Do not delete until build manifests, runtime imports and Termux/package installation references have been checked.
4. **Safe generated-debt removal — verified within Cognitive Lab, not a repository-wide deletion.** Technical Debt Steward removes candidate annotation comments and normalizes trailing whitespace before independent test execution and senior approval; the previously recorded 33-cycle run performed 22 cleanups. It refuses to silently erase FIXME/TODO, debugger or dynamic evaluation; those become blockers. This preserves behavior and reviewer provenance.

## Verification

- Local cognitive, security, policy and integration suite: `node --test tests/cognitive-lab/*.test.mjs tests/nova/cognitive-capsule.test.mjs` (46 passing tests when this audit was prepared).
- Targeted autonomous-merge policy tests execute the same JavaScript block used by the trusted GitHub workflow against mocked workflow status, PR metadata and changed-file lists; cover green, failure, pending, governance changes, reviewer veto, non-PR trigger and fork.
- IDE TSX syntax validated via TypeScript `transpileModule` without parse errors; complete type safety, runtime build and API integration depend on the repository's GitHub CI.
- A full manual browser UX acceptance test on the user's actual Termux installation has **not** been performed. The new panel is read-only and labels deterministic simulation, hash-chain evidence and local Git without implying GitHub main merge.

## Next cleanup candidates (require separate ownership proof)

- Canonicalize duplicate entrypoints/public assets only after running both root and runtime builds, verifying release contents, and testing Android/Termux, Windows and JACO Lite startup.
- Audit historically named SEER paths separately before renaming: active integration contracts and workflows still reference them, and blind deletion would break the running IDE.
- Maintain a debt budget by PR: count introduced violations and keep zero new blockers. Do not advertise repository-wide zero-debt without an exhaustive scan.