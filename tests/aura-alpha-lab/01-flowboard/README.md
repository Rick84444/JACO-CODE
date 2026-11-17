# Flowboard

A persistent, offline Kanban board.

Run the lab HTTP server from the checkout root: `node tests/aura-alpha-lab/serve.mjs`.
Open `http://localhost:4173/01-flowboard/`.
Run tests: `node --test tests/aura-alpha-lab/01-flowboard/core.test.mjs`.

## Aura extension mission
Add due dates, overdue filtering and JSON export; preserve existing locally saved tasks. Test migration and invalid dates.

Work in an isolated branch/worktree, keep the baseline tests green, add a failing regression first and a passing result after repair. Report actual test output, changed paths and commit. No external accounts, spend or deployment. Browser smoke and restart/persistence tests must be observed, not inferred from unit tests.
