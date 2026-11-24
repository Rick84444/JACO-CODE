# JACO Enterprise Operating Structure — unproven reference architecture
Status: DESIGN BASELINE / UNPROVEN ENTERPRISE SYSTEM
Date: 2026-11-24
Authority: operator's standing mandate; this document cannot grant permissions.
Repository: Rick84444/JACO-CODE
Parent: openspec/changes/standing-operator-mandate/research-contract.md

## 0. Executive decision
JACO is one product with **one canonical Aura primary agent**, one operator-owned intuition, one durable mission graph, one execution authority, and multiple subordinate *roles/capabilities*, not independent competing runtimes. Do not build another agent kernel, scheduler, memory engine, model router, tool registry or GUI if an existing one can be adapted.

This is a complete target *structure* for an unproven enterprise system, **not a claim of working enterprise deployment**. No tests or runtime execution are claimed.

## 1. Roles and governance
- **Operator / product owner**: authors the durable goal/intuition, edits standing mandate and extra rules, may pause/revoke/steer, chooses identity/provider credentials, may accept explicit financial commitments.
- **Aura / executive orchestrator**: sole goal and mission owner; delegates bounded work through existing Mission Bus and execution leases; cannot enlarge operator authority.
- **Work allocation specialist**: derives dependency graph, estimates cost/time, assigns capabilities, records owner/lease, avoids parallel writers.
- **Developer specialist**: inspects repository, proposes smallest compatible change, produces code/tests/migration artifacts and provenance.
- **Adversarial critic**: independently challenges requirements, scope, tests, security and evidence; may block promotion but cannot alter authority.
- **Verifier**: runs reproducible test and build gates, binds receipts to immutable commit/config/model/environment identities.
- **Release operator capability**: executes authorized CI/merge/deploy only after required receipts and policy check; no independent principal.
- **Reliability specialist**: handles restart, orphaned leases, incident state, rollback/reconciliation and observability.
- **Knowledge curator**: promotes tested, provenance-backed patterns into skills; no automatic promotion from model claims alone.

Roles are workflow responsibilities; multiple model calls or workers may implement them, but they do not create new primary agents or authority.

## 2. Authority model
- Standing operator mandate is persisted once and remains until operator changes or revokes it. Explicit short-lived overrides may be supported, but never become the default.
- Separate *capability visibility*, *provider authentication*, *effective authorization*, and *action verification*. A green UI toggle does not prove authentication or successful execution.
- Effective decision combines operator mandate, explicit denies, target scope, org delegation attenuation, mission constraints, MCP server access, adapter constraints and invariant financial approval. No layer may grant more than its parent.
- Natural-language custom rules are bounded instructions, not credentials or permission grants.
- Version every operator change with actor, timestamp, previous hash, next hash and atomic persistence; reject stale GUI updates. Re-evaluate before every effectful action, including after a plan/steer revision.
- On damaged or missing authority state, fail closed for privilege; offer visible recovery. Never silently regenerate revoked grants.
- Revocation affects subsequent actions; in-flight irreversible effects require a receipt or uncertain-outcome reconciliation.
- Scope every grant by workspace/repository/branch/origin/device/remote endpoint as applicable. The operator may preapprove push, merge, deployment and external writes within explicit scope, without repetitive approvals. No force-push, secret disclosure or payments by inference from broad autonomy.
- External identities: JACO login, GitHub OAuth/device flow, Google OAuth, ChatGPT consumer sign-in, OpenAI API authorization and Anthropic/Claude API authorization are distinct; implement only provider-supported flows. Never exchange one provider's cookies/tokens for another's access.

## 3. Canonical runtime data plane
```text
Operator GUI / VS Code / Android remote client
        | authenticated operator commands and read-only observations
        v
Standing Mandate + Operator Intuition (versioned, durable)
        |                         |
        v                         v
Aura Cognitive Kernel <------> Gameboard (projection only)
        |
Mission Graph / Durable Mission Bus / single-writer lease
        |
Work allocation -> developer -> critic -> verifier -> release
        |                                 |
        +-------- Evidence Ledger <-------+
        |
Existing Tool/Capability Adapters (MCP, CDP, desktop, shell, git, cloud)
        |
Verified action receipts -> observability -> knowledge promotion
```
No GUI direct tool execution. No worker self-issued permissions. No second Mission Bus.

## 4. Startup and lifecycle
1. Load durable operator identity and authority state; do not bootstrap a new grant on subsequent starts.
2. Load registered capabilities/providers; enumerate installed MCP servers and CDP/desktop adapters.
3. Evaluate effective enablement and operator denies *before* starting each adapter.
4. Start bounded local core services; launch enabled bundled adapters, probe readiness and record evidence. Lazy-start other configured servers on first authorized call.
5. External services without credentials show AUTH_REQUIRED; disconnected devices show UNAVAILABLE. Do not claim READY from registration.
6. Restore mission/lease state, classify interrupted side effects as UNKNOWN until reconciled; never blindly replay non-idempotent calls.
7. Resume eligible missions according to operator pause/revocation state, resource budget and policy revision.
8. Stream verified progress to GUI/terminal/Gameboard without claiming that a rendered view is proof of execution.

States: UNCONFIGURED, AUTH_REQUIRED, DISABLED, STARTING, READY_VERIFIED, DEGRADED, UNAVAILABLE, REVOKED, UNKNOWN_EFFECT. Every transition has a timestamp and reason.

## 5. Mission state machine
PROPOSED -> PLANNED -> QUEUED -> LEASED -> RUNNING -> VERIFYING -> VERIFIED -> COMPLETE.
Alternative transitions: BLOCKED_POLICY, BLOCKED_AUTH, BLOCKED_DEPENDENCY, PAUSED_OPERATOR, FAILED_RETRYABLE, FAILED_FINAL, UNKNOWN_EFFECT, CANCELLED, ROLLBACK_PENDING, ROLLED_BACK.
- Only verified receipts satisfy graph edges.
- Operator intuition remains unchanged across replans; steering is versioned and separate.
- A worker receives a bounded capability token / policy reference, not unrestricted authority.
- Every side effect has idempotency key, precondition, scope, lease, expected postcondition and receipt. Unknown effects are reconciled, not retried automatically.
- Resource governance: context/token budget, model fallback, concurrency, deadlines, monetary budget and backpressure.

## 6. Provider and authentication strategy
- Provider-neutral model interface with explicit provider/model selection, health check, pricing/context window where known, failure semantics, and cost accounting.
- Local models and remote providers share mission state, not secret stores or implicit OAuth sessions.
- GitHub GUI already implements `gh auth login --web` device flow via `GitHubLoginPanel.tsx` and `githubGuiAuth.mjs`; reuse.
- Google sign-in may be used for JACO identity only with an explicit supported OAuth implementation. Signing into GitHub with Google does not authorize Google APIs.
- ChatGPT and Claude connections require supported APIs, official delegated auth or other explicitly supported integrations. Consumer subscription login is not automatically a programmable API credential.
- Secrets remain in a protected vault/OS store, never in model context, logs, Gameboard or git.

## 7. Enterprise reliability and security
- Availability: health/readiness/liveness separate, exponential backoff with jitter, circuit breakers, bounded queues, restart recovery and manual kill switch.
- Integrity: single writer per workspace/mission, durable event log, CAS revisions, signed/hashed evidence provenance, rollback receipts, tamper-evident audit trail.
- Security: deny precedence, no privilege escalation from untrusted web/repo text, secret redaction, per-provider scopes, least authority for workers, sandbox isolation where practical.
- Observability: structured traces linking intuition_id, mission_id, ticket_id, policy_revision, action_id, tool_id, provider_id, evidence_ref, commit_sha; redact sensitive inputs.
- Performance: baseline P50/P95 mission latency, tool success, verified outcomes, retries, context tokens, cost, memory, CPU, startup and recovery time.
- Data: migration and backup/restore tests, retention policy, schema compatibility, audit immutability, secret rotation and corruption recovery.
- Deployment: versioned packages, staging and canary, rollback, compatibility matrix Windows/Android/VS Code, reproducible release manifests.

## 8. Research and cognitive improvement
Knowledge Object schema: source commit, task, purpose, environment, dependencies, tests, benchmarks, confidence *calibration*, failure modes, alternatives, applicability, owner, provenance and supersedes link.
Hypothesis engine: generate alternatives -> independent critic -> test plan -> isolated experiment -> comparable benchmark -> choose or reject -> record counterevidence -> promote only verified reusable skill.
Compression: consolidate recurring successful patterns only after semantic equivalence checks and regression tests. No self-asserted success rates, fabricated benchmarks or autonomous production promotion without mandate.
Model changes must not erase mission state, evidence, operator goal or approval history.

## 9. Source audit — confirmed findings and caveats
- `runtime/src/server/autonomy/autonomyMandate.ts` uses maxHours 8760 and expiresAt; currently not a permanent mandate.
- `runtime/src/server/relay/modelRelay.ts` consumes AutonomyMandateStore for browser/desktop/Android relay, propagates expiring grants; it is not the universal authorization layer.
- `runtime/src/server/connected/agentOrganization.mjs` has a separate organization authority and grant expiry; `agents/lib/org-permission.mjs` checks task grants with missing-file exceptions.
- `runtime/src/server/capabilities/capabilityPolicy.mjs` enables task switches by default but does not own MCP server access; `runtime/src/server/mcp/stdioMcpHost.mjs` owns MCP agentAccess and denies.
- `runtime/src/server/connected/connectedRuntime.mjs` creates CapabilityPolicy and DurableMissionBus; its `createGoal` currently uses `input.providerId || 'ollama'`, a provider-default inconsistency requiring investigation before change.
- `runtime/src/components/GitHubLoginPanel.tsx` uses existing GitHub device login; `tests/nova/startup-developer-connections.test.mjs` has mock tests for GitHub login, Chrome and bundled MCP startup.
- `docs/cognitive-gameboard-intuition.md` documents original intuition and Gameboard as projection; known limitation: project-mode coding graph may remain coarse.
- `docs/architecture/aura-runtime-mcp-cdp-audit.md` documents CDP/MCP routes and Windows verification gaps.
Source inspection is not runtime execution; no current real-Windows evidence is claimed.

## 10. Delivery work packages and dependencies
WP01 authority call graph and source-of-truth decision (blocked until all write paths inspected).
WP02 standing mandate schema + migration + indefinite grant + revision/CAS (depends WP01).
WP03 authorization adapter unification for mission, chat, shell, Git, MCP, CDP, desktop and Android (depends WP02).
WP04 GUI persistent policy editor, custom rules, audit and effective-permission preview (depends WP02/03).
WP05 startup discovery/readiness and credentials integration (can proceed in parallel with WP02, must integrate WP03).
WP06 Gameboard/intuition/steering and role delegation evidence links (depends WP03).
WP07 independent critic, failure injection, CI tests and security review (continuous).
WP08 real Windows/Chrome/MCP/model end-to-end validation, restart/rollback and production readiness (depends WP02-07).
WP09 performance baselines, multi-provider comparative evaluation, skill promotion and enterprise hardening (depends WP08).

## 11. Acceptance contract
Do not claim enterprise readiness until:
- All existing unit/integration/build suites pass on exact commit; no skipped required gates.
- Policy persists across restarts and long time horizons without silently expiring; revocation applies on next action.
- All actual action paths honor effective authority; no missing/corrupt state grants new privilege.
- MCP/CDP/desktop startup is observed on real Windows with verified actions, not only mocks.
- GitHub auth works through official flow; external providers correctly distinguish auth-required from connected.
- Push/merge/deploy within operator scope complete with reproducible receipts; out-of-scope effects blocked.
- Failure injection covers crash during external mutation, restart, stale leases, duplicate delivery, revoked tokens and corrupt store.
- CI/build/install/uninstall and rollback on target Windows machine are verified.
- Benchmarks are reproducible and record cost, tokens, latency, success and evidence quality.
- Independent critic signs off only on evidence, not role-play assertions.

## 12. Open decisions
D1 canonical authority store vs organization attenuation (must follow complete call graph).
D2 no-expiry representation and adapter compatibility (avoid fake far-future dates).
D3 supported ChatGPT/Claude authentication and provider access contracts (verify official current documentation).
D4 target Windows environment, available Chrome debugging profile and actual MCP inventory.
D5 rollout/migration strategy and reversibility for existing operator grants.
