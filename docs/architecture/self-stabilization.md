# Contract-bound stabilization

The existing authenticated `POST /cortex/self-development` endpoint accepts
`mode: "stabilize"`. It uses the existing mission graph, executor, coding contract,
receipt store and budget gates, not a new repair runtime.

Example payload (adapt scope and checks to the actual project):

```json
{
  "mode": "stabilize",
  "objective": "Reproduce and repair the API regression",
  "scope": { "allowed": ["src/**", "tests/**"] },
  "acceptance": ["Regression test fails before the patch and passes after it", "API health matches the expected service"],
  "services": [{"id":"api","entry":"src/server.mjs","healthPath":"/health","identity":"project-api"}],
  "verification": {"commands":["npm test"],"required_stages":["service","api"]},
  "execution": {"allow_git_push":false,"allow_git_merge":false},
  "dispatch": true
}
```

Stabilization requires tests, a falsifier, receipts and independent verification;
request flags cannot disable the latter two checks. Required service/API/browser
stages and service definitions now survive graph construction and are checked by
the canonical coding contract. No independent verifier means no verified completion.
Empty explicit command lists are rejected. The graph's push declaration reflects
its actual contract permission.

This does not implement an automatic incident watcher, reproduce-before-patch gate,
or deployment rollback. The example's before/after criterion remains an acceptance
requirement; do not confuse it with a new machine-enforced baseline gate. Existing
budgets and uncertain-outcome quarantine remain responsible for stopping execution.
A verification receipt is not proof that the installed phone runtime was repaired.

Validation: 16 self-development/integration/coding-contract tests passed, including
real temporary Git workspace execution and missing independent/API/service evidence
blocking completion. JavaScript syntax and whitespace checks passed.
