# JACO Autonomous Coding Contract v1

The IDE coding runtime treats `jaco.coding-contract/v1` as executable mission authority, not prompt text.

A coding mission must provide an objective, explicit allowed/forbidden repository scope, acceptance criteria, verification commands, and a bounded execution budget. Nova may use `repo-list`, `repo-read`, `repo-write`, `repo-test`, `git-status`, `git-diff`, and `git-commit` only when the durable mission carries a valid coding contract.

The runtime enforces the contract at the Nova mission boundary. Writes outside scope are rejected. Test commands must exactly match commands named by the contract. A Git commit is rejected until required test/falsifier receipts exist after the latest write. Completion remains an operator-reviewed acceptance decision. If independent verification is required, completion remains blocked until evidence from a distinct verifier is supplied.

## Contract example

```json
{
  "schema": "jaco.coding-contract/v1",
  "objective": "Repair durable Nova recovery",
  "scope": {
    "allowed": ["agents/nova/**", "gateway/src/**", "tests/**"],
    "forbidden": [".env*", "**/*secret*"]
  },
  "acceptance": [
    "mission survives restart",
    "existing tests remain green",
    "new recovery test passes"
  ],
  "execution": {
    "autonomous": true,
    "require_human_before_destructive_action": true,
    "allow_git_commit": true
  },
  "verification": {
    "tests_required": true,
    "falsifier_required": true,
    "independent_verification": false,
    "receipt_required": true,
    "commands": ["npm test", "node --test tests/nova/recovery.test.mjs"]
  },
  "budget": {
    "max_steps": 12,
    "max_tool_calls": 40,
    "max_failures": 3,
    "max_duration_ms": 1800000
  }
}
```

## Canonical engineering phases

`UNDERSTAND -> REPOSITORY_MODEL -> HYPOTHESES -> PLAN -> IMPLEMENT -> TEST -> FALSIFY -> VERIFY -> COMMIT -> RECEIPT`

The v1 gate enforces scope, budget, contracted verification commands, receipt ordering, and commit/completion prerequisites. Phase persistence and a dedicated verifier identity can be layered on without changing the contract schema.

## Authority boundary

- SEER defines or routes the mission objective and strategy.
- The durable Nova mission stores the contract and receipts.
- Nova plans and executes only actions allowed by both `mission.allowedTasks` and the coding contract.
- The coding workspace can edit, test, inspect Git state, and create scoped local commits.
- `git push` is intentionally not exposed by the coding task surface.
- Contract acceptance remains an explicit operator resolution after machine-verification gates pass.
