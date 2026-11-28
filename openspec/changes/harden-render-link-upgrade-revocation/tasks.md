# Tasks

- [x] Inspect main, #405, #420, the existing Render link adapter and AGENTS.md / openspec/project.md.
- [x] Preserve PR #420 unchanged and implement the post-upgrade durable revocation check on a stacked branch.
- [x] Add controlled regression tests for late revocation, positive admission and unavailable database.
- [x] Verify code revision `4e47e97ae405a03d242eb4c32ddef52ff2d6a33e` in the JACO Cloud Render contract workflow (23/23 contract tests, 1/1 real PostgreSQL integration test, syntax checks); Technical Debt Steward Gate also passed. Documentation-only follow-up commit requires its own CI.
- [ ] Obtain independent code/security review and reconcile changes safely into the originating cloud branch.
- [ ] Verify real Render, OAuth MCP, user account, JACO Link host and ChatGPT-to-Aura end-to-end before claiming readiness.
