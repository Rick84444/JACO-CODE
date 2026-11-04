# Prioritized work loop for JACO agents

Status: SPEC for the whole loop; each iteration gets a separate evidence status.
Operator decision 2026-09-23: sub-agents may review and clean up the repository; commit, push and merge are approved within the task and the verification limits below.

## Goal and mandate

Make the existing JACO runtime stable at startup, model-independent, resumable and verifiable. Integrate canonical owners; build no parallel agent, Vault, planning or sync systems.

The approval is not permission to delete unknown working files, publish secrets, bypass protection rules, use unbounded paid inference, change economic locks or abort other people's active missions. A start request must not automatically expose new public endpoints. Request a decision when cost, a destructive migration or a new security policy is involved.

This document is a run instruction and backlog, not an installed background scheduler. No continuous operation or future automatic run may be claimed unless such a mechanism has actually been configured.

## Agent roles and ownership

| Role | Responsibility | Restriction |
| --- | --- | --- |
| Coordinator/integrator | Main goal, current backlog, Workspace, file ownership, integration, Git delivery | The only Git writer for the iteration |
| Startup agent | Start order, identity check, configuration, timeout, process ownership | No production stops without coordination |
| Runtime agent | Provider routing, bounded retries, durable missions, receipts | No model or cost overrides |
| Repository agent | Generated files, ignore rules, documentation and proven dead code | No unknown files are deleted; no mass formatting |
| Independent reviewer | Failure paths, secrecy, test quality, diff and acceptance criteria | Does not review its own change as independent evidence |

At most three bounded subtasks in parallel per coordinator. Roles may switch between iterations. All agents must read AGENTS.md, the master contract, the bootstrap contract and any closer instructions; register their own truthful agent card; sync, ACK and publish READY before shared work. If Workplace is missing: DEGRADED_UNSYNCED, no invented coordination decisions.

## Loop: from observation to verified delivery

### 1. Read the real state

- Identify checkout, remote, branch, HEAD, origin/master and the actual remote SHA. Fetch the current remote status before integration.
- List dirty/untracked files. Label them with a known owner or UNKNOWN; do not include them automatically.
- Read Workplace DECISION, CLAIM, HANDOFF, ERROR and current missions. Coordination history is a lead, not Git or runtime evidence.
- Identify active processes, port, product identity, start source and mission owner without printing secret process arguments.
- Document Current State, Target State, Gap, Constraints, Risk and Verification Plan.

### 2. Choose the next prioritized task

Choose the highest unresolved risk that can be bounded and verified. A blocked physical device does not prevent independent source code work. Do not move to UI polish while runtime correctness is unresolved.

Every work package must contain: id, main goal, priority, canonical owner, file scope, responsible agent, dependencies, reproduction, acceptance criteria, test commands, stop conditions, rollback and evidence links. Do not set arbitrary time promises.

### 3. Assign and secure file ownership

- The coordinator delegates a concrete file scope and expected evidence.
- The agent takes a Workspace claim. A conflict means coordination, not overwriting.
- Renew the claim and heartbeat during the work. Publish significant findings when they are discovered.
- Use PROGRESS/RESULT only with a real missionId; otherwise FINDING/HANDOFF.

### 4. Reproduce and implement

- Create a regression test for the observed bug where possible.
- Choose the smallest complete change in the existing owner; no alternative engines or fake successes.
- Model choice comes from explicit configuration/capabilities. Fallback requires an explicit policy and the existing cost/privacy gate.
- Retries have a deadline, attempt budget, backoff and cancellation. Mutating operations must not be repeated on an unknown outcome without reconciliation.
- Critical state is written durably before success is reported. Secret values must not end up in argv, logs, test fixtures, reports or Git.

### 5. Verify in layers

1. Syntax, schema, lint/typecheck and the relevant build.
2. Unit tests for the normal case plus missing configuration, auth errors, network errors, timeout, duplicate calls and malformed responses.
3. Integration through the actual registration/import/route, not an orphan module.
4. Isolated runtime test with controlled state and its own ports. Test fixtures must not unintentionally inherit the operator's .env.
5. Coordinated target-machine verification once ownership and permissions are clear.
6. Persistence and recovery: interruption/restart, the same idempotency key, no duplicate side effects, a verifiable final receipt.

HTTP 200 alone is never enough. Check product identity, schema, payload and the expected postcondition. Model metadata is not inference evidence. A seeded Android peer is not a connected device. A passed test suite with an internal live skip is not full-stack evidence.

### 6. Independent review

The reviewer checks the scoped diff, connection to the runtime, failure paths, permissions, race conditions, secret risk and evidence. Critical/high findings block merge. Code changed after review requires a new relevant review and tests; old green results do not apply automatically.

### 7. Commit, push and merge

- The coordinator reviews the exact file list and diff. Stage explicit paths, never everything in a shared dirty repository.
- Check for secrets and unintended environment/state files. Document the baseline, tests and remaining limitations.
- Commit and push on a bounded branch; create or update the right PR. Avoid duplicate PRs for the same patch.
- Check the current base/master and handle drift without overwriting other people's changes. Run the tests again after conflict resolution.
- Merge is approved only when the required checks are green on the exact current head, the review is done and the merge is possible. Missing checks do not count as green; never use an admin bypass.
- A bounded source code fix may be merged with a documented remaining operational test, but must then not be called fully operationally verified.
- Verify the remote master after merge and the link to the PR/commit. Report MERGED separately from TARGET-HOST VERIFIED.

### 8. Startup and deployment

- Check that no other agent owns an ongoing mutation/reload. Document active Nova missions and the recovery mode.
- Run a side-effect-free preflight: executables, configuration without values, ports, dependencies and the right product identity.
- A busy port is not a healthy JACO service. Adopt only a verified correct service with clear ownership; otherwise abort before duplicate processes are started.
- Read the chosen installation's start contract. Root npm start, the Windows stack, the Continuum CLI and Android/Termux are not interchangeable start commands.
- Start only the necessary components in a verified dependency order. Do not start trading loops, public tunnels or optional services implicitly.
- On failure: save sanitized evidence, stop only processes the iteration itself started and owns. No blind kill-all or reset.
- Check a real bounded mission: plan -> execution -> durable receipt -> evidence -> verified result. Keep operator review where the contract requires it.

### 9. Reflect, hand over and choose the next round

Publish structured worked, failed, unexpected, root_causes, reusable_patterns, future_improvements and knowledge_updates. Every conclusion has provenance and a verification status; old evidence can become STALE.

Update the backlog, the current risk, the next owner and the reproduction steps. Close/release claims. Continue with the next independent task while the mandate and context apply. When a new permission or a real user decision is needed: report the blocker and request only what is missing.

## Prioritized backlog and acceptance

### P0 — truthful security and safe starts

**P0.1 Native Vault status and handshake.** The current review has found success/StrongBox claims without a verified Android broker. The canonical route owner must be identified against the existing Vault. Acceptance: an absent broker gives unavailable/unverified, no successful native import/lease claims; a real configured broker verifies identity/challenge and gives durable evidence. No secrets in responses/logs.

**P0.2 Side effects of startup.** Preflight before Vault import and process start; preserve the operator's paid-provider policy; prevent silent loss of Vault-loaded runtime credentials. Acceptance: a missing prerequisite or port conflict starts nothing; a valid configuration remains unchanged; no secret values in diagnostics.

### P1 — explicit routing, process ownership and recovery

**P1.1 Model choice from configuration.** Remove the unintended DeepSeek override in the governor and the automatic paid fallback. Separate general provider selection from local discovery. Acceptance: every supported provider starts without a local-enum crash; a failure of the chosen Ollama calls no other provider unless fallback is explicitly allowed. No Gemma substitute for a chosen cloud model.

**P1.2 One canonical startup owner per operating mode.** Document the Windows stack, Continuum and Termux; improve identity-validated adoption and the spawn error/health deadline. Acceptance: a second start attempt creates no duplicates; a wrong service on a port is not stopped/adopted; a failed child start gives a clear error and the correct exit status.

**P1.3 Nova/SEER bounded execution.** Acceptance: a provider timeout and a permanent auth error lead to bounded attempts and an explicit blocked status; a restart restores the mission and receipts without duplicate mutation; UNKNOWN_OUTCOME is reconciled.

**P1.4 Real Android/desktop sync.** Fetch the non-secret connection configuration from the Git/Workspace owner. Acceptance: physical device identity, authenticated heartbeat, schema, sequence/ACK, durable round trip and reconnection after restart. A seeded OFFLINE entry is not enough. Requires an available device; block only the device-dependent steps.

### P2 — repository hygiene and verification breadth

**P2.1 Ignore and secrets.** Protect real .env variants but keep explicit example templates; review diagnostics without printing contents. Acceptance: negative and positive ignore tests; no real keys or session tokens in the scoped Git diff.

**P2.2 Duplicated/leftover files.** Inventory tracked .bak, generated state and alternative start documents. Prove the absence of imports, packaging/build references and runtime use before removal. Unknown or user-owned files are left in place with an ownership question. A Git-tracked removal must be restorable.

**P2.3 Reproducible CI.** Locked dependencies, relevant path filters, Windows/Termux-specific contracts and clear live-skip statuses. Acceptance: green on the exact PR head and the correct failure status for a really failed runtime test.

### P3 — knowledge and long-term evidence

Extract reusable failure patterns after verified iterations. Build an endurance test with bounded cost and explicit interruption, memory/process measurement and restart recovery. UI polish comes after these correctness gates.

## Iteration journal

Every iteration must report the following without equating the levels:

| Field | Content |
| --- | --- |
| ID and main goal | Backlog id, concrete scope and canonical owner |
| Baseline | Checkout, branch, local SHA, remote SHA, other dirty files |
| Agents | Agent id, responsibility, file claims and reviewer |
| Change | Exact file list and why |
| Evidence | Commands/results, skips, CI run, runtime observations |
| Git | Commit, PR, head SHA, merge/master SHA or NOT_MERGED |
| Operation | NOT_RELOADED / IMPLEMENTED_UNVERIFIED / TARGET-HOST VERIFIED |
| Remaining | Blockers, next step, rollback and owner |

The first ongoing iteration covers bounded startup hardening and repository hygiene. The whole backlog is not finished or scheduled just because this document exists.
