# Tasks and evidence map

## Baseline / proof
- [x] Capture exact main commit and complete non-truncated recursive GitHub tree (1,248 blobs).
- [x] Group exact Git object IDs (23 duplicate groups, 48 file occurrences); classify only by observed path/content.
- [x] Inspect root and runtime AGENTS.md, master behavior contract, existing debt workflow and prior 2026-10-28 audit.
- [x] Inspect root/runtime start.sh, package scripts and root install.sh for a static launcher-context ambiguity.
- [x] Identify PR #230 / merged PR #231 overlap on NovaMissionControl.mjs; do not merge the older draft blindly.
- [x] Implement a read-only Git-tree scanner and its synthetic regression cases.
- [x] Integrate inventory command into the existing technical-debt gate.
- [ ] Observe green test and CI results on this audit PR's **exact head SHA**.
- [ ] Run official OpenSpec CLI validation against this change folder (not available in this GitHub-only session).

## Deeper architecture and cleanup (unresolved)
- [ ] Establish real import/caller/consumer graph for runtime, agents, gateway, native clients, installers and release packaging.
- [ ] Decide single canonical source for 8 mirrored public/docs pairs and other assets; verify all distribution outputs before changing paths.
- [ ] Fix or retire root start.sh only after tests for its expected invocation contexts and install.sh behavior.
- [ ] Rebase/reconcile PR #230 against merged PR #231 and run joint mission regression and crash/soak tests.
- [ ] Consolidate overlapping behavioral contracts without weakening invariant or agent-specific instructions.
- [ ] Review deprecated workerRunner polling compatibility, and verify it has no live consumers before removal.
- [ ] Audit all three npm lockfile sets with authoritative current versions and advisories, then run full build/test/install smoke.
- [ ] Verify Windows, VS Code, Android and Termux target-host compatibility for any removals.
- [ ] Re-run the complete Git tree and semantic dependency analysis after cleanup, produce before/after counts and close only evidenced findings.

**Acceptance:** repository-wide debt-free status remains UNVERIFIED until all relevant areas are classified and validated. A green report-only inventory is not a clean bill.
