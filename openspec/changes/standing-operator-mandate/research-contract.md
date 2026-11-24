# Standing Operator Mandate — implementation contract
Status: RESEARCH / NOT IMPLEMENTED
Owner: Aura canonical runtime. This document grants no authority.
Date: 2026-11-24

## Operator intent
A durable mandate is configured once in the GUI and remains effective until explicitly changed or revoked by the operator. A mission inherits it; no per-mission reapproval for already authorized actions. The operator's original intuition remains the immutable goal anchor; Gameboard is a read-only projection of actual missions/evidence. Aura is the sole primary agent.

Tool adapters (MCP, CDP, desktop, shell, git, providers) should be discoverable at startup and usable when configured, reachable, authenticated and permitted. A registered tool is not proof of readiness. First-time external authentication uses each provider's supported flow, never assumed cross-provider account access.

## Verified existing implementation
- `runtime/src/server/autonomy/autonomyMandate.ts`: persistent `AutonomyMandateStore`, `sign`, `revoke`, `evaluate`, bootstrap Level-5 grant. `maxHours` capped at 8760; `isActive` requires `expiresAt` in future. **Does not satisfy indefinite operator-controlled validity.**
- `runtime/src/server/connected/agentOrganization.mjs`: independent org permission/traits store and grants; `GRANT_DAYS` default 30 max 90; `AUTONOMY[5]` defined. **Another expiry source.**
- `agents/lib/org-permission.mjs`: reads organization file on each task, but returns unrestricted when file or agent is missing. **Potential inconsistent fail-open scope; inspect all callers and migration before changing.**
- `runtime/src/server/capabilities/capabilityPolicy.mjs`: task/skill switches default enabled; persists disabled lists. Missing/damaged state returns defaults. MCP server access explicitly belongs to `stdioMcpHost`.
- `agents/lib/approval-policy.mjs`: `JACO_AUTO_APPROVE_LEVEL` defaults to 5, optional separate file and policy-edit grant.
- `agents/lib/operator-action-guard.mjs`: bounded `PRE_APPROVABLE` action categories for sandbox contracts; other effects require review.
- `runtime/src/server/gate/policyRules.ts`: additional file, shell and system-patch decisions.
- `runtime/src/server/mcp/stdioMcpHost.mjs`: configured MCP servers start lazily; independent server read/write/off and deny list; remote HTTP write restriction.
- `docs/architecture/aura-runtime-mcp-cdp-audit.md`: documents lazy MCP discovery, CDP attachment and real-Windows validation gaps.
- `docs/cognitive-gameboard-intuition.md`: operator intuition is durable goal, Aura sole primary agent, Gameboard not execution authority.

## Required design (not yet accepted as code)
1. **Single operator-owned mandate**: choose an existing store as canonical after tracing all routes and callers. Do not create a competing policy engine or bypass current hard security boundaries. Add a non-expiring validity mode only for explicit operator grants. Existing expiring grants must retain their semantics until migrated.
2. **Explicit authorization precedence**: operator revocation > tool/server deny > scoped mission constraints > standing operator grant > default. Unknown or corrupt *authority* state must never silently increase privilege. Task visibility may default on, but visibility is not authorization.
3. **Revisioned authority**: monotonic revision, audit actor, time, prior/new hash; atomic writes; compare-and-swap for concurrent GUI edits. Runtime checks current revision immediately before every effectful action. Mid-flight revocation cannot undo completed side effects; uncertain outcomes require reconciliation, not blind retries.
4. **Mission inheritance**: mission references standing mandate identity/revision; cannot enlarge its scope. Changes apply to subsequent actions without restarting the mission. Additional natural-language rules constrain behavior but never create grants by themselves.
5. **Startup readiness**: enumerate configured tools and models, probe health with bounded timeout, reconnect with backoff, report states registered/enabled/reachable/verified/failed. Never automatically authenticate to third-party accounts by using unrelated credentials. MCP/CDP launch is conditional on local availability and operator grant; disabled adapters remain disabled.
6. **Gameboard**: display intuition, active mandate revision, effective constraints, blockers and evidence. Board does not mint permissions or synthesize success.
7. **Model-provider separation**: OAuth login to JACO, authorization to GitHub/Google, and access to ChatGPT/Claude model APIs are distinct contracts; use only supported provider-specific flows.

## Test matrix — mandatory before merge
T01 first install with explicit grant: default tool visibility and signed standing mandate; no silent privilege elevation.
T02 restart 1/10/365+ days later: non-expiring operator grant remains valid; existing time-limited grant still expires.
T03 GUI disable one tool while a mission is active: next tool action denied, unrelated permitted actions continue.
T04 concurrent GUI writes: stale revision rejected; no lost updates.
T05 corrupt/missing authority file: no implicit elevation; recovery path visible in GUI.
T06 permission propagation: mission bus, direct chat MCP, stdio MCP, CDP/browser, desktop, shell, git and provider calls enforce same effective decision.
T07 external write/push/merge/deploy: preauthorized scope works without repetitive approvals; out-of-scope effects denied/reviewed; financial commitments retain explicit operator review.
T08 uncertain outcome: no automatic replay of non-idempotent action after timeout/restart.
T09 restart/reconnect: registered MCP is not falsely shown verified; stopped configured server lazily starts on authorized use; CDP wrong target does not destroy valid session.
T10 intuition: steering changes the plan but not operator's original intuition or authority.
T11 migration: previous mandates, organization grants, disabled switches, MCP access and audit logs preserved.
T12 real Windows: Chrome debug profile, MCP tool read/write, Git worktree, model inference, GUI toggle and crash recovery tested with receipts.

## Review process
Planner: map call graph and source of truth. Developer: minimal code patch and tests. Critic: independent counterexamples, failure injection and regression review. No merge until actual test receipts and required CI exist. No invented status.
