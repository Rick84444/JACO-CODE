# Immutable baseline evidence

## Scope

- Observed GitHub main: `118f2970a6f4912cfa71f9818368470318f3905f` (2026-11-13).
- GitHub recursive tree: `truncated=false`, 1,430 tree records = 1,248 tracked blobs + 182 directories; approximately 10.7 MB tracked blob content.
- Exact Git SHA duplicate groups: 23; files participating: 48. This is byte-identical content only.
- 8 identical documentation pairs under `public/docs/` and `runtime/public/docs/`.
- 7 files under `runtime/docs/archive/`; 4 under `runtime/docs/wip/`.
- No OpenSpec files in main at this commit. **Open PR #231 does contain an OpenSpec change**, but this is not merged into main.

## Evidence-backed findings

### F-01 [REAL] Historical mirror debt remains inventoried, not retired (P1)
Source: [October 28 debt audit](https://github.com/Rick84444/JACO-CODE/blob/118f2970a6f4912cfa71f9818368470318f3905f/docs/cognitive/REPO_TECHNICAL_DEBT_AUDIT_2026-10-28.md). It expressly withheld deletion pending package, imports and platform coverage. Current Git tree still has 23 exact duplicate groups. Category does not imply removability.

### F-02 [RISK] Root launcher differs from current canonical startup (P1)
`start.sh` and `runtime/start.sh` are identical blobs. Both run `npm run start` if their local `dist/server.cjs` exists, while the root `package.json` has `start` mapped to `agents/hands-off-agent.mjs`; the runtime package uses `dist/server.cjs`, and the root `README.md` instructs `npm run jaco:start`. These are different lifecycle paths. Root `install.sh` contains a Windows-only full-stack branch when agents/lib/local-stack.mjs is present. This is a **static context/ownership ambiguity**, not an executed root-start failure. Test installed and source invocations before deleting either script.

### F-03 [REAL] New-debt CI does not certify whole-repository cleanliness (P1)
`scripts/verify-technical-debt.mjs` examines only added executable JavaScript/TypeScript diff lines for debugger, dynamic eval, TODO/FIXME, generated candidate comments and trailing whitespace. It does not inspect old files, modules, duplicate ownership, lockfile age or deployed behavior. The dedicated Aura runtime debt gate is path-limited. Green CI cannot be treated as a comprehensive cleanup certificate.

### F-04 [RISK] Multiple overlapping behavior contracts (P1)
Root `AGENTS.md`, root `JACO_MASTER_BEHAVIOR_CONTRACT.md` and nested `runtime/AGENTS.md` all contain contributor/agent direction. In particular, root master says respond in the operator's language, while nested runtime contract says default English. Instructions apply at different scopes, so this is a **governance reconciliation candidate**, not proof that either file is unused.

### F-05 [REAL] Open overlapping mission-recovery changes (P0 integration risk)
PR [#230](https://github.com/Rick84444/JACO-CODE/pull/230) and PR [#231](https://github.com/Rick84444/JACO-CODE/pull/231) both modify `runtime/src/server/connected/novaMissionControl.mjs` against the same baseline. PR #231 has an OpenSpec delta; PR #230 is draft. These need review/rebase and joint regression tests. This evidence alone does not prove a merge conflict.

### F-06 [RISK] Deprecated worker compatibility remains in source (P2)
`runtime/src/server/agents/workerRunner.ts` explicitly labels polling APIs deprecated and retains a disabled implementation. It also lists job types such as model_benchmark/system_patch while processSingleJob does not handle those in its switch. Callers and execution reachability are not yet inventoried, so deleting it would be premature.

### F-07 [UNKNOWN] Dependency freshness and vulnerabilities (P1 assessment)
Open [PR #225](https://github.com/Rick84444/JACO-CODE/pull/225) proposes eight npm dependency updates across root, runtime and gateway. This is evidence of pending upgrade proposals, **not** proof of a current exploitable vulnerability or compatibility failure. npm audit, registry age and target-specific compatibility were not run.

## Counter-evidence and unverified scopes

The existing architecture guide explicitly preserves read-only legacy API behavior and notes historical module names can remain to preserve leases. Byte equality is not a sound deletion criterion. No full AST call graph, installed Windows soak, live Android/Termux run, full package vulnerability audit or OpenSpec CLI validation has been observed during this audit.
