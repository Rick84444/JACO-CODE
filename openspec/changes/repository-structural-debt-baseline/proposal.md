# Repository structural-debt evidence baseline

## Why

The repository's existing debt gate protects only newly added risky JavaScript/TypeScript lines. It cannot certify that the full repository is free of duplicated ownership, broken entrypoints, stale files, outdated dependencies or unverified operational paths. An earlier audit (2026-10-28) explicitly withheld deleting mirrored files without caller and packaging proof. Current runtime recovery PRs share a Mission Control change surface.

## What Changes

- Add a deterministic, read-only inventory of every tracked Git blob and exact duplicate Git object, with categories and explicit review limits.
- Run this inventory alongside the existing Technical Debt Steward Gate on PRs and main, without weakening its new-debt rejection.
- Establish testable requirements and evidence-linked follow-up tasks for architecture ownership, callers, migration, distribution, dependency age and host acceptance.
- Declare existing findings as open debt until the relevant contract and platform tests prove removal safe. No automatic deletion.

## Capabilities

### Modified: repository-debt-verification

Use the existing Technical Debt Steward Gate as the execution owner for a full tracked-tree inventory. No second runtime, scheduler, memory store or developer policy.

## Impact

- Affected: repository-level debt gate, read-only audit script, deterministic unit tests, and OpenSpec audit artifacts.
- Not changed: production runtime, mission bus, active user data, UI or deployment code.
- Reference baseline: main 118f2970a6f4912cfa71f9818368470318f3905f (2026-11-13).
- This proposal **does not** certify that the repository is already debt-free.
