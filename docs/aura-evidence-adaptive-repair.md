# Aura Adaptive Repair — evidence-first, single-agent

## Problem addressed

The canonical agent loop already executes through Nova mission leases, contract
validation, approval gates and durable receipts. Its stuck detector can recognize
repeated steps, but a plain tool-error string often produces another speculative
attempt. Neither a failed tool response nor a model proposal is evidence that a
repair succeeded.

## Implementation

- `agents/lib/adaptive-repair.mjs` converts a **real executed action receipt**
  into a bounded `jaco.aura.adaptive-repair/v1` advisory packet.
- `agents/lib/agent-loop.mjs` attaches this advice to the same tool-result
  message, without another agent, inference call, mission or approval flow.
- The packet distinguishes missing path, test failure, authority denial,
  transient dependency failure, unknown side-effect outcome, and generic error.
- Hypotheses are expressly **unverified** and can only name tools already in the
  active mission's `allowedTasks`. A test failure encourages inspection before
  a minimal edit; permissions and budgets remain unmodified.
- A tool acknowledgment with `outcomeUnknown: true` is **not** success proof.
  Suggested reconciliation uses only read-only observations. The existing runtime
  remains responsible for blocking uncertain mutations, leases, and status.
- Two or more observed failures in the same class change the advice from
  inspection to changing strategy or naming a concrete blocker.
- Operator steering takes precedence on every model turn; advice is never
  authority. The same Aura owns the mission in Windows, VS Code and Remote.

## Evidence and limitations

Unit tests cover scope preservation, retry classification, refusal, repeated
failure and acknowledged-but-uncertain effects. An integration test uses the
real durable mission controller and shows the advice reaching a subsequent
model turn after a failed step.

This PR **does not** yet generate model-proposed patch candidates, rank patches
by independently verified test results, feed the Continuum Hypothesis Engine
automatically, or prove higher SWE-bench scores. Those require a measured
baseline and integration contract; suggesting alternatives is not autonomous
self-improvement. The current feature does not infer file paths from errors,
modify scope, execute new actions, change approval levels or auto-repeat writes.

## Acceptance

```bash
node --experimental-sqlite --test \
  tests/nova/adaptive-repair.test.mjs \
  tests/nova/agent-loop.test.mjs
```

Then run GitHub CI and perform a real Windows model-provider acceptance:
1. Create an authorized coding mission with a reproducible failing test.
2. Confirm Aura receives a compact recovery packet containing only allowed
   tools and changes its next attempt on the observed evidence.
3. Verify a successful code correction by a fresh test receipt and the
   existing completion contract — never by the model's claim alone.
4. Inject an uncertain write response; verify no blind replay occurs.
5. Interrupt and steer from Remote while the mission runs; verify latest
   operator direction wins and old tool proposals cannot execute.

Rollback: revert this PR. No schema, stored history or mission IDs are migrated.
