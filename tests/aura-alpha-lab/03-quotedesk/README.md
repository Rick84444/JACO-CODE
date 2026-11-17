# Quotedesk

SEK quotation calculator with integer-öre arithmetic, discount and VAT.

Run the lab HTTP server from the checkout root: `node tests/aura-alpha-lab/serve.mjs`.
Open `http://localhost:4173/03-quotedesk/`.
Run tests: `node --test tests/aura-alpha-lab/03-quotedesk/core.test.mjs`.

## Aura extension mission
Add per-line VAT and a printable quote. Validate rounding on mixed VAT rates with explicit rounding policy. No payments or external invoicing.

Work in an isolated branch/worktree, keep the baseline tests green, add a failing regression first and a passing result after repair. Report actual test output, changed paths and commit. No external accounts, spend or deployment. Browser smoke and restart/persistence tests must be observed, not inferred from unit tests.
