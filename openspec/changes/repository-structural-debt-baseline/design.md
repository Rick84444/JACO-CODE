# Design: evidence-first repository debt audit

## Canonical boundaries

Reuse the existing root Git tree as truth for **tracked-file inventory**, AGENTS.md for implementation rules, the existing scripts/verify-technical-debt.mjs for newly added risky lines and .github/workflows/technical-debt-gate.yml for CI. Keep the runtime unchanged.

## Phase A: static inventory (implemented in this change)

Run git ls-tree -r -z HEAD on the checked-out commit. Parse NUL-separated records; count all blobs and group identical blob SHAs. Report categories: public distribution mirror, launcher duplicate, licensing copy, type declaration shim, branded copy and unclassified. Emit an explicit NOT_DEBT_FREE status regardless of whether duplicate groups exist. Never mutate or delete.

The scanner also reports one bounded, static launcher mismatch if the identical root and runtime start.sh scripts use cwd-relative paths but their package start commands select distinct lifecycles. It does not claim live execution failure. It uses no network, package installation, model or private secrets.

## Phase B: actual architecture audit (not yet complete)

Trace every candidate's imports, callers, service ownership and installed distribution consumers. Produce a call graph covering Aura planner, Mission Control, Durable Mission Bus, Workplace supervisor, local-stack, Windows installer and VS Code/Android clients. Mark runtime probes and execution receipts separately from simulation. Resolve overlap between active PR #230 and #231 before merge.

## Phase C: controlled remediation (not yet complete)

Assign canonical owners, write migration tests and make one removal per independently verifiable PR. For public mirrors, choose a source and validate both output roots. For legacy entrypoints, make behavior explicit and verify platform compatibility. For package upgrades, inspect current advisories and lockfiles; update with full build and host tests.

## Evidence integrity and limits

- Report is keyed to a concrete main commit rather than claiming current live-host state.
- The 23 SHA groups are exact-content matches only, not proof of 23 redundant implementations.
- A green gate means static checks ran; it is not comprehensive AST/caller, security, dependency or OS verification.
- OpenSpec tooling validation, full caller graph and installed-host acceptance are separate tasks, not implicitly completed by these artifacts.
