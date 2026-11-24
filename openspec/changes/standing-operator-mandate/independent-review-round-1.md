# Independent reviewer — round 1
Date: 2026-11-24
Status: BLOCKING; source review only, tests not executed

## Evidence-backed correction to initial design
`AutonomyMandateStore` is not the universal authority. Repository search located its runtime construction in `runtime/src/server/relay/modelRelay.ts`; it gates semantic relay actions for BROWSER, DESKTOP and ANDROID. It does not by itself authorize shell, Git, MCP or mission-bus execution.

`modelRelay.ts` signs and propagates browser/desktop/Android grants, evaluates consequences before relay actions, and derives browser grants just in time. The mandate's `expiresAt` is passed into these grants, so replacing expiry with null requires coordinated adapter changes, not a one-line edit.

`tests/nova/autonomy-clock.test.mjs` explicitly asserts a maximum of one year. This test must be revised deliberately when persistent grants are implemented; do not remove coverage of short-lived grants.

`agents/lib/org-permission.mjs` is called from `agents/hands-off-agent.mjs` and holds organization-chain permission checks; `runtime/src/server/connected/agentOrganization.mjs` defines separate 30/90-day permission grants.

`agents/lib/operator-action-guard.mjs` is invoked by `agents/lib/safe-shell.mjs`, `runtime/src/server/mcp/auraAgentMcpCall.mjs`, and `runtime/src/server/connected/novaMissionControl.mjs`. Its `preApproved` applies inside a sandbox coding contract, not universally. `tests/nova/contract-preapproval.test.mjs` asserts this boundary.

`runtime/src/server/capabilities/capabilityPolicy.mjs` states all task switches default on; MCP's server-level access remains independently enforced by `stdioMcpHost.mjs`. Changing GUI switches alone does not prove unified authority.

## Rejected shortcuts
1. Remove `expiresAt` from the mandate type without updating browser/desktop/Android grant protocols: REJECT.
2. Treat `CapabilityPolicy.isTaskEnabled()` as authorization for external writes: REJECT.
3. Bypass `operatorApprovalCheck` globally because Level 5 is enabled: REJECT.
4. Auto-enable disabled MCP servers or replay saved third-party tokens: REJECT.
5. Declare integration complete based on a green unit test without Windows and real Chrome evidence: REJECT.

## Required next evidence
- Full call graph of the model relay router mount and the mission/GUI settings routes.
- Trace GUI policy mutation -> persistent store -> running task check -> MCP/CDP/desktop action receipt.
- Determine whether `AgentOrganization` should be the canonical operator authority or an organizational attenuation layer; do not guess.
- Define a migration preserving explicit revocations, old expiry semantics, and configured MCP denies.
- Test concurrency and crashes before any release.

## Verdict
Design direction accepted; implementation NOT approved. No code has been executed, no tests have been run, no Windows connection has been observed.
