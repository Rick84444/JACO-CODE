# Pathfinder

Dependency planner with cycle detection and earliest possible execution schedule.

Run the lab HTTP server from the checkout root: `node tests/aura-alpha-lab/serve.mjs`.
Open `http://localhost:4173/05-pathfinder/`.
Run tests: `node --test tests/aura-alpha-lab/05-pathfinder/core.test.mjs`.

## Aura extension mission
Add editable dependencies, critical-path highlighting and a maximum concurrent worker limit. Test cycle rejection and constrained schedule.

Work in an isolated branch/worktree, keep the baseline tests green, add a failing regression first and a passing result after repair. Report actual test output, changed paths and commit. No external accounts, spend or deployment. Browser smoke and restart/persistence tests must be observed, not inferred from unit tests.
