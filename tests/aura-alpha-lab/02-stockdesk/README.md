# Stockdesk

Local inventory with validated stock movements.

Run the lab HTTP server from the checkout root: `node tests/aura-alpha-lab/serve.mjs`.
Open `http://localhost:4173/02-stockdesk/`.
Run tests: `node --test tests/aura-alpha-lab/02-stockdesk/core.test.mjs`.

## Aura extension mission
Create an append-only movement ledger and low-stock threshold per SKU. Verify that reload and rejected stock movements preserve consistency.

Work in an isolated branch/worktree, keep the baseline tests green, add a failing regression first and a passing result after repair. Report actual test output, changed paths and commit. No external accounts, spend or deployment. Browser smoke and restart/persistence tests must be observed, not inferred from unit tests.
