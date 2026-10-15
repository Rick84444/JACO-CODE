# JACO Self-Development Runtime

Status: canonical design target for contract-bound autonomous code improvement.

## Authority chain

```
SEER strategy
  -> self-development request
  -> jaco.self-development/v1
  -> SEER Mission Graph
  -> jaco.coding-contract/v1
  -> durable Nova mission
  -> repository read/write/test/falsify
  -> scoped git commit
  -> verified receipts
  -> operator release decision
```

The runtime may improve code autonomously inside an authenticated, explicit scope. It does **not** gain implicit permission to push, deploy, rewrite its verification boundary, or modify legacy evidence.

## Protected root-authority paths

The self-development builder always forbids mutation of:

- GitHub workflow gates
- root package manifests/lockfiles
- the active Nova executor
- the coding-contract validator
- the coding workspace executor
- the SEER governor, strategy kernel, self-development policy builder and mission-graph implementation
- Nova mission-control enforcement
- `legacy/**`

Changing those files requires a separate operator-issued engineering contract.

## Verification

A self-development contract requires:

- explicit acceptance criteria;
- at least one allowlisted verification command;
- tests;
- a falsifier by default;
- verified receipts after the latest write;
- scoped commit authorization;
- no git push or deployment authority.

Allowed verification commands are intentionally narrow: `npm test`, selected `npm run test:*`/lint/build/typecheck/check scripts, `node --test ...`, and `node --check <file>`. Shell composition, absolute paths and parent-directory traversal are rejected.

## Release semantics

A successful coding mission may create a local git commit because the operator authorized the self-development request. The durable mission still reaches `AWAITING_VERIFICATION`; promotion/release remains an explicit decision. This separates autonomous engineering from autonomous release authority.
