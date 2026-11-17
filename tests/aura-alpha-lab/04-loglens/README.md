# Loglens

Offline log triage with severity counters and filters.

Run the lab HTTP server from the checkout root: `node tests/aura-alpha-lab/serve.mjs`.
Open `http://localhost:4173/04-loglens/`.
Run tests: `node --test tests/aura-alpha-lab/04-loglens/core.test.mjs`.

## Aura extension mission
Add timestamps, duplicate error grouping and an explicit redact-before-export feature. Use synthetic secrets generated at runtime; never upload logs.

Work in an isolated branch/worktree, keep the baseline tests green, add a failing regression first and a passing result after repair. Report actual test output, changed paths and commit. No external accounts, spend or deployment. Browser smoke and restart/persistence tests must be observed, not inferred from unit tests.
