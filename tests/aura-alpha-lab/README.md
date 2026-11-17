# Aura Alpha Lab — five working baseline projects

Independent development/test applications; not a new Aura runtime. No dependencies, credentials, accounts or outbound service calls. The static server listens only on loopback.

## Start

From the repository root with Node 24:

```sh
node tests/aura-alpha-lab/test.mjs
node tests/aura-alpha-lab/serve.mjs
````

Open http://localhost:4173 . All five applications have a functional browser surface, deterministic core module and unit tests. Flowboard and Stockdesk persist in the browser; other apps hold data for the current page session. No deployment.

## Projects and follow-up missions

- [Flowboard](./01-flowboard/README.md): A persistent, offline Kanban board. **Challenge:** Add due dates, overdue filtering and JSON export; preserve existing locally saved tasks. Test migration and invalid dates.
- [Stockdesk](./02-stockdesk/README.md): Local inventory with validated stock movements. **Challenge:** Create an append-only movement ledger and low-stock threshold per SKU. Verify that reload and rejected stock movements preserve consistency.
- [Quotedesk](./03-quotedesk/README.md): SEK quotation calculator with integer-öre arithmetic, discount and VAT. **Challenge:** Add per-line VAT and a printable quote. Validate rounding on mixed VAT rates with explicit rounding policy. No payments or external invoicing.
- [Loglens](./04-loglens/README.md): Offline log triage with severity counters and filters. **Challenge:** Add timestamps, duplicate error grouping and an explicit redact-before-export feature. Use synthetic secrets generated at runtime; never upload logs.
- [Pathfinder](./05-pathfinder/README.md): Dependency planner with cycle detection and earliest possible execution schedule. **Challenge:** Add editable dependencies, critical-path highlighting and a maximum concurrent worker limit. Test cycle rejection and constrained schedule.

## Evaluation protocol

Run each extension as a separate bounded mission on its own worktree. Capture starting Git SHA, baseline test results, failed hypothesis/first error, changed files, final test evidence, browser smoke, elapsed time, tool calls and operator interruptions. For any claimed restart resilience, actually interrupt and resume the mission. Never count registration or a file read as a completed project. Success = all stated acceptance conditions with verified artifacts; unit tests do not prove live Aura execution. Do not increase authority, introduce paid dependencies or merge into main as part of these exercises.
