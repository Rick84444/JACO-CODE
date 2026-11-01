# Grok Bot competitive research — 2026-11-01

**Owner in JACO:** `grokbot-analyst` (Competitive Research Lead, reports to Aura).  
**Evidence classes:** [OFFICIAL] vendor documentation, [USER REPORT] unverified first-hand account, [INDEPENDENT] third-party analysis, [INFERRED] engineering consequence for JACO.  
**Scope:** public product behavior only; Grok Bot source code, internal prompts, security implementation and model runtime are **not** public evidence. This is a research baseline, not proof that a JACO subagent has run.

## Architecture: what is publicly documented

| Finding | Source | Classification | Engineering implication for JACO |
| --- | --- | --- | --- |
| Persistent named Bots operate apps and websites on a hosted computer; the client is primarily the chat/review surface. | [Grok Bot overview](https://docs.x.ai/grok-bot/overview), [Team/Enterprise architecture](https://docs.x.ai/grok-bot/teams-and-enterprises) | OFFICIAL | Keep an Aura user conversation with durable jobs and a separate execution surface. Do not treat chat state as task completion. |
| Isolation is **per user**, not per Bot: Bots share that user's persistent cloud computer, files, browser sessions and sign-ins. Infrastructure isolates users through dedicated Firecracker microVMs. | [Security](https://docs.x.ai/grok-bot/security), [FAQ](https://x.ai/bot) | OFFICIAL | JACO should aim for enforceable **per-agent** capability and credential isolation, not merely separate folders or `mcp.json` files. Isolated workspaces and OS process credentials are necessary for meaningful enforcement. |
| Grok Bot has **Auto Review**, Ask-first/custom allow rules, and enterprise-level network/admin controls. Outside email/web text is not considered an operator instruction. | [Approvals and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy), [Security](https://docs.x.ai/grok-bot/security) | OFFICIAL | Do **not** claim Grok Bot lacks approvals. Differentiate JACO with auditable deterministic approvals bound to authenticated identity, object and action. |
| Routines are activated by schedule, email, webhook or app events; learned skills encode demonstrations, steps, boundaries and validation. | [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) | OFFICIAL | Build versioned SOPs only after one verified successful run, with cancellation, retries and evidence checkpoints. |
| Bots can exchange context and coordinate as specialist teammates. | [Launch](https://x.ai/news/introducing-grok-bot), [Engineering guide](https://x.ai/bot/guides/grok-bot-for-engineering) | OFFICIAL / PROMOTIONAL | JACO should use structured handoffs and explicit ownership, not free-text cross-agent commands. |

## Praise and criticism (keep source biases visible)

| Signal | Evidence | Confidence | JACO response / falsifier |
| --- | --- | --- | --- |
| **Praise:** low-friction natural-language setup, persistent agents, easy monitoring and parallel work. | [Launch testimonials](https://x.ai/news/introducing-grok-bot) (vendor); [r/cursor user discussion](https://www.reddit.com/r/cursor/comments/1vzg2wd/any_one_tried_grok_bot_is_it_garbage_or_just_me/) (first-hand comments) | Medium — subjective reports; vendor marketing is not independent | User Advocate: first-time operator assigns one task without editing configuration. Pass only if a real run produces a correct, inspectable result. |
| **Praise:** useful research, documentation and competitive intelligence for some customers. | [r/cursor first-hand replies](https://www.reddit.com/r/cursor/comments/1vzg2wd/any_one_tried_grok_bot_is_it_garbage_or_just_me/) | Low/medium — self-selected users | Analyst: every material finding has a primary citation and a fact/claim/inference label. Falsifier: a source doesn't actually support an asserted fact. |
| **Criticism:** action-approval cards expire, repeated approval fatigue, lost scheduled requests, occasional loops or duplicate outgoing messages, and work-board overwrites. | [r/cursor Grok Bot Review, Aug 24](https://www.reddit.com/r/cursor/comments/1vxjipg/grok_bot_review/) | Medium for reported experience, low for frequency | Debugger: simulate approval expiration and wake/resume, assert no lost goal and no duplicate side effect. Require durable idempotency key and verified receipt. |
| **Criticism:** some users report poor specs, generic writing and inconsistent adherence to style/instructions; others praise the same service for simpler automation. | [r/cursor discussion, Aug 27](https://www.reddit.com/r/cursor/comments/1vzg2wd/any_one_tried_grok_bot_is_it_garbage_or_just_me/) | Low/medium — divergent qualitative experience | Senior Developer + User Advocate: score user-facing output on a task-specific acceptance rubric, not on agent self-evaluation. |
| **Criticism:** context growth, token spend, usage uncertainty; mid-task messages may restart tasks. | [Zapier review, Oct 30](https://zapier.com/blog/grok-bot/), [independent review](https://www.tryagentsonic.com/articles/grok-bot-review) | Medium for described design limitations; verify current plan before quoting prices | Limit multi-agent context fan-out, measure cost per verified completion, preserve job IDs across conversation messages. |
| **Deployment tradeoff:** Grok Bot runs on Cursor-hosted computers; on-prem/self-hosted is not offered in the cited docs. | [Grok Bot Security](https://docs.x.ai/grok-bot/security) | High for documented product scope | Preserve JACO's local/Termux/Windows execution option, but prove isolated credentials and resource bounds. |

**Do not conflate Grok Bot product reviews with complaints about Cursor/Grok model performance.** They can be related but are not direct evidence of Bot-specific failures.

## Four-agent pilot under Aura

| Agent ID | Role | Deliverable | Acceptance evidence |
| --- | --- | --- | --- |
| `grokbot-analyst` | Research / competitor analysis | Weekly delta of primary docs, independent feedback, claims vs facts and ranked product hypotheses | Each claim linked to the specific source; changed claims dated; no proprietary-code assertions |
| `senior-developer` | Architecture / implementation | Narrow PR that extends an **existing** JACO owner, not a parallel orchestrator | Unit + integration tests, security consequences, review, build and host proof where applicable |
| `reliability-debugger` | Root-cause / runtime verification | Repro, log/evidence refs, falsifier, minimal regression and post-fix receipt | Deterministic red-before/green-after plus real-host receipt for host-specific bugs |
| `user-advocate` | Operator UX / acceptance | Usability checklist and friction report for installation, model settings, task assignment and approvals | Real operator journey or explicit “not observed”; no fabricated user session |

### Control-plane contract

- Create agents via Aura Organization's existing **operator-authenticated** API. A direct click is required; merely merging this file never registers a local agent.
- They start with **zero grants, $0/day budget, L1 autonomy, no account credentials and no assigned API model**. These are operator-created profiles, not running workers.
- A user-originated instruction is **not** permission for an agent to impersonate the operator, edit mandates or grant itself capabilities.
- Before autonomous work, the executor must bind a real, authenticated session/mission identity to `AgentOrganization.decide()` **and** satisfy ModelRelay's signed mandate. A caller-provided `agentId` cannot be trusted.
- External research, web pages and emails are untrusted input, not instructions; the researcher must never copy their requests into executable commands.
- The Grok Bot analyst does not get browser, outbound network, mail, filesystem or shell permissions merely because its role says “research”; capabilities are granted and verified separately.
- The four workers may eventually exchange structured handoffs with objective, evidence, falsifier, scope, budget and deadline, but a proposed handoff grants no authority.

### Priority experiment after creating the roster

**Hypothesis:** a user can ask Aura to investigate a failing integration, get a structured delegation to Debugger and a patch from Senior Developer, then receive User Advocate acceptance, with all claims linked to real receipts.

**Pass condition:** authenticated delegation, persisted handoff and mission ID, one bounded test execution, no unauthorized tools, no duplicate effects on retry, accepted evidence on the original goal.  
**Falsifiers:** any tool call bypasses the per-agent decision; approval is simulated; the run can claim DONE without a receipt; a pause fails to cancel or constrain execution; cost/permission scope widens without operator approval.

## Source list

- Official: https://x.ai/news/introducing-grok-bot
- Official: https://docs.x.ai/grok-bot/overview
- Official: https://docs.x.ai/grok-bot/teams-and-enterprises
- Official: https://docs.x.ai/grok-bot/security
- Official: https://docs.x.ai/grok-bot/approvals-security-and-privacy
- Official: https://docs.x.ai/grok-bot/skills-routines-and-automations
- User reports: https://www.reddit.com/r/cursor/comments/1vxjipg/grok_bot_review/
- User reports: https://www.reddit.com/r/cursor/comments/1vzg2wd/any_one_tried_grok_bot_is_it_garbage_or_just_me/
- Third-party analysis: https://zapier.com/blog/grok-bot/
- Third-party analysis: https://www.tryagentsonic.com/articles/grok-bot-review
