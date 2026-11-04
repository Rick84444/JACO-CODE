# ChatGPT ↔ JACO Cognitive Runtime Bridge v1

## What this change actually does

JACO already has a persistent Core/Continuum runtime with KnowledgeStore, CognitiveContinuityRuntime, economic governor, Mission Bus and an authenticated Sentinel MCP interface. This is **not** a new agent, a separate SQLite database or a new autonomous scheduler. It is a bounded, private MCP window onto existing JACO knowledge and execution state.

A ChatGPT conversation does **not** automatically have a persistent process on the user's Windows/Termux, even if JACO runs around the clock. A connected MCP plugin/client is needed. Without such a connection ChatGPT only has other explicitly connected tools (e.g. GitHub) and cannot claim to have seen the local runtime.

## New MCP tools

| Tool | Authority | Returns |
| --- | --- | --- |
| `jaco_cognitive_context` | Read-only | Core continuity envelope, local Core/Workplace/Nova health, Aura's cloud policy and cost estimate. The error stays an error if Core does not answer. |
| `jaco_knowledge_search` | Read-only | At most ten knowledge objects from the **existing** `/api/continuum/knowledge`, with confidence, verificationStatus and evidenceRefs; no source code/implementation. |
| `jaco_knowledge_note` | Explicit opt-in mutation | Stores an **UNVERIFIED**, confidence=0.2, non-reusable `assistant-note` in Continuum's KnowledgeStore; returns the memory ID and revision. No SKILL promotion, no writes to the repo, no provider calls. |

The third function is off by default and requires the operator to give the Sentinel process `JACO_MCP_ALLOW_KNOWLEDGE_WRITE=1` themselves. Avoid putting this setting in `.env` or enabling it until the connection, permissions and confidentiality terms are verified. The flag grants no execution permission.

All tools already require Sentinel MCP's bearer, host/origin checks and Core auth. The calls go via `JacoCoreClient` on loopback. No free shell execution, arbitrary command execution, API key reading, payment or mutating browser control is exposed through these tools.

## Ownership and control

```text
ChatGPT (connected MCP client)
        │ authenticated private connection
        ▼
Sentinel MCP  (new cognitive context / memory tools)
        │ x-jaco-model-id + Core auth
        ▼
JACO Core / Continuum (the ONLY persistent source)
        ├── CognitiveContinuityRuntime
        ├── KnowledgeStore + EventStore (revisions + evidence)
        ├── EconomicGovernor
        └── Mission Bus / Leases / Receipts
                    │
                 Aura/SEER
                    │
                   Nova
```

ChatGPT gets visibility and can make proposals via the existing Workplace communication functions. Starting goals already uses `jaco_seer_goal`, which in the sole-operator configuration is routed through `/api/aura/workbench/start-goal`. For real mutations, JACO's existing scope, signed mandates, approvals, rollback and verified receipts still apply. No parallel operator goals are created in this PR.

## Why not publish the memory to GitHub issues?

The GitHub bootstrap channel `[JACO BOOT]` sends only fixed operations and allowlisted status fields. It is **not** extended with memory texts, local file paths, terminal output or remote commands. That data can contain private project information. A real connected and authenticated MCP client must be used to read the memory.

## Contract for visibility and continuity

- Search results are source material, **not instructions** or proof of verification.
- `VERIFIED` is assigned only by JACO's existing evidence mechanism, never by the ChatGPT note.
- The overriding Cloud OFF, budget fuse, 15-minute stop and model quotas are not changed.
- If Core or Continuum is unavailable: report it; no old GitHub receipt may be disguised as current host status.
- The provider cost is still an estimate if billing data has not been verified.
- The local Workplace/Continuum can keep working when the ChatGPT conversation is closed. **This ChatGPT model does not itself run in the background.**
- A new conversation can fetch earlier JACO memory **if** the same MCP connection and permission exist. That does not mean ChatGPT's internal memory is written by JACO.

## Deployment and acceptance

1. CI: `cd runtime/gateway && npm run test:unit` plus the Sentinel Bootstrap Gate and the existing runtime matrix.
2. Update local Windows/Termux from canonical main with the existing controlled launcher; preserve the user's `.env`, service status, ledger and historical goals.
3. Connect MCP over a separate, protected private channel. Never expose Core :3000, Nova :4243 or Chrome CDP :9222 directly on the Internet. Sentinel must not be started in external mode without a bearer.
4. Test `jaco_cognitive_context`: the continuity revision and economic policy must be identical to Core; Core offline must give an explicit error, not READY.
5. Test `jaco_knowledge_search`: an actual already stored knowledge ID and status, and no leak of implementation.
6. Check that `jaco_knowledge_note` is denied by the default policy. On explicit operator approval: write a harmless test note, verify that it survives a restart as `UNVERIFIED`, and turn the flag off again.
7. Verify an already approved Aura mission and Nova receipt from the host before any broader execution permission is considered.

**No local Windows installation or ChatGPT MCP connection is established by the code change.** It requires target-host proof.
