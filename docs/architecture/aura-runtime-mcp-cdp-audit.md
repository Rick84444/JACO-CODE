# Aura runtime audit: policy, tool execution, MCP and CDP

**Scope:** existing JACO CODE runtime, the first Aura Live causal-workspace slice, and the supported browser/tool connections. No additional primary agent, tool registry, planner, or GUI.

**Evidence levels:** [REAL] inspected source contracts and CI results, [RISK] unverified interoperability/lifecycle edge, [SPEC] proposed follow-up. This document is not evidence of running Chrome or a target Windows installer.

## External architecture comparison (official sources)

| Platform | Observed architectural pattern | Decision for JACO |
| --- | --- | --- |
| OpenAI Codex app-server | Application owns UX and application data; agent harness owns the model/tool loop, environment executes tools, events describe the item lifecycle and approvals | Keep one Aura control plane; use Mission Bus receipts as the execution truth and send derived observations to Aura Live |
| OpenHands | Agent server/action-execution boundary; event-driven actions and observations; UI does not execute the agent's tools directly | Browser, files, shell and MCP remain behind existing runtime tools, never invoked by a new UI execution loop |
| MCP specification | Tool capabilities and JSON Schema declarations, negotiated transport lifecycle, and independent server permission settings | Tool discovery must not mean tool execution; a stopped *configured* server can start lazily, but disabled/denied tools never execute |
| Chrome DevTools / Chrome DevTools MCP | Dedicated debugging profile, explicit connection to a target, origin/session awareness; manual attach and automatic attach are different authority flows | Keep CDP pinned to the intended loopback debugging port and page, and preserve an existing connection when a new target cannot be attached |

Primary documentation:
- https://developers.openai.com/blog/codex-as-a-platform
- https://developers.openai.com/api/docs/guides/agents-api/architecture
- https://github.com/OpenHands/OpenHands/blob/main/docs/architecture.md
- https://github.com/OpenHands/docs/blob/main/sdk/arch/agent.mdx
- https://modelcontextprotocol.io/specification/draft/changelog
- https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions
- https://developer.chrome.com/blog/remote-debugging-port
- https://developer.chrome.com/docs/devtools/agents/get-started/configuration

## Actual owner and connection graph

\`\`\`text
Operator / JACO GUI
        |
        v
One Aura chat / mission contract ------> Operator approval policy
        |                                        |
        +--> plan graph --> mission --> tool action (bounded / permission checked)
                                    |       |
                                    |       +--> MCP host (stdio / HTTPS remote)
                                    |       +--> BrowserHandsOff (CDP browser session)
                                    |       +--> Nova bridge (CDP MCP facade via loopback)
                                    |       +--> filesystem / shell / git
                                    v
                          durable action receipt
                                    |
                                    v
                      Cognitive Live / evidence API
                                    |
                         +----------+----------+
                         |                     |
                       Aura Live             Gameboard
\`\`\`

In the current runtime, the CDP facade (default port **2996**) forwards authorized tools to the Nova browser bridge (**4243**), which in turn uses Chrome CDP (typically **9222**). The separate BrowserHandsOff API also uses CDP but has its own explicitly granted browser session and verified action receipts. The GUI's direct CDP MCP route is restricted to read-only observation tools; browser mutations must use the authorized browser actuator. Do not collapse these into a new uncontrolled actuator.

### Tool/execution authority

- Existing control: \`StdioMcpHost.agentRefusal\` checks configured server access (\`off/read/write\`), deny lists, sensitive path arguments and remote write restrictions. \`NovaMissionControl\` applies the existing mission policy for durable tools.
- **Defect [REAL]:** chat-facing \`mcp_tool\` previously checked \`status === READY\` *before* calling the host, while the MCP host intentionally starts configured servers on first use. The chat agent could not use a stopped server without separate manual startup.
- **Fix:** \`auraAgentMcpCall.mjs\` discovers an already-configured, policy-permitted server lazily through the canonical host, then delegates the call to that **same** host with \`actor:'agent'\`. The host's permission checks remain authoritative. An \`mcp_discover\` query makes tools available to Aura without calling them.
- **Policy consistency:** high-impact outward \`mcp_tool\` chat writes now require the existing mission approval path; local, permitted workspace mutations stay autonomous. \`off\` and deny lists are applied before server startup.
- This is **not** a general widening of access to arbitrary remote MCP endpoints.

### CDP/MCP facade contract

- **Defect [REAL]:** all arguments in \`tools/list\` were marked required, including optional \`expectedUrl\` and \`expect\`; the internal validator compared \`typeof []\` with \`'array'\`, refusing valid uploads.
- **Fix:** JSON Schema \`required\` now matches the operation contract; arrays enforce \`items/minItems/maxItems\`, nested objects are validated and unknown argument keys are refused.
- The facade retains existing authentication, target scope, explicit \`actionId\` on writes, and verified-response checks. No screenshot content is copied into durable general-purpose logs.
- A failed network tool call is not retried as if it were side-effect-free; uncertain effects remain unknown.

### CDP attachment lifecycle

- **Defect [REAL]:** \`BrowserSessionManager.attach\` previously detached the current valid tab *before* validating or establishing its replacement. A wrong URL, unavailable Chrome debugging port or ambiguous target could destroy the working session.
- **Fix:** validate and connect the replacement first; swap only on success. An epoch invalidates a pending attach after a newer attach/detach, closing its late socket instead of reviving it.
- **Fix:** \`CdpBridge.attach\` now validates that Chrome's advertised page WebSocket points to the expected **loopback host and the same debug port**; the target-list request is timeout bounded.
- Keep Chrome's separate debugging profile when JACO launches it. Never infer that an existing operator Chrome profile is isolated or that a service listening on 9222 proves usable CDP.

### How tools become useful to Aura Live

\`tool registration -> allowed discovery -> executed action -> observation -> verified receipt -> Gameboard node -> human/technical view\`

Neither a green MCP status nor a displayed Chrome tab is evidence of execution. Only a specific source-bound action/receipt can advance a graph step. Aura Live is read-only presentation; it cannot authorize or retry tools itself.

The existing \`causal_workspace\` read tool lets the **same** Aura inspect bounded mission/action/graph links. It is not a second reasoning model, autonomous supervisor, or separate memory store.

## Open risks requiring separate evidence

1. **[RISK] MCP 2026-07-28:** JACO's current MCP clients negotiate the 2025-06-18 handshake-era protocol, while newer MCP implementations support the 2026-07-28 stateless discovery era. Do not assert modern-protocol compatibility or silently replace transports. First add a negotiation test matrix against both handshake and modern-only real endpoints, then migrate deliberately without breaking legacy servers.
2. **[RISK] Real Chrome/Windows:** mocked CDP tests and controlled desktop browser UI tests are not proof of CDP attaching on the user's installed Windows system. Validate actual Chrome profile, process ownership, target selection, lifetime and WebSocket reconnect.
3. **[RISK] Complete terminal details:** Cognitive Live deliberately excludes raw command inputs and stdout/stderr. A detailed per-action log endpoint with redaction, bounded output, identity and retention is still required for a full Live Terminal.
4. **[RISK] Long-lived session/stream:** reconnecting after a service restart must not claim that an interrupted external mutation succeeded or retry it without a receipt.
5. **[SPEC] Unified capability/effects metadata:** consolidate explicit tool categories, workspace roots, declared side effects, safe previews and verification requirements using the existing capability policy, not another registry.
6. **[SPEC] End-to-end autonomy:** execute a real mission with MCP tool read/write, browser observation and local tests, inspect receipts and project-aware Gameboard links, and compare expected outcomes to actual outcomes.

## Acceptance / regression gates

- Real HTTP MCP calls for \`nova_click\`, \`nova_click_named\` and \`nova_upload\` accept valid schemas and refuse invalid arrays before reaching upstream.
- Failed/ambiguous CDP re-attach preserves a working browser; successful re-attach closes the replaced transport; stale attach after detach is refused.
- A configured stopped MCP server becomes usable by Aura on its first authorized tool call.
- Agent access \`off\`, server deny lists, read-only mode, remote write restriction and protected paths remain effective.
- High-impact external MCP writes from direct chat do not bypass mission approval, while scoped local writes work.
- CI: TypeScript, client/server builds, MCP/CDP regression, existing action evidence, Gameboard and controlled browser tests must all pass. Do not merge with skipped required CI or an unverified merge base.
- Target-host Windows/CDP and full terminal streaming remain separate acceptance tests after merge.

### Changed modules

\`agents/cdp-bridge.mjs\` / \`runtime/src/server/browser/router.ts\` / \`runtime/src/server/browser/browserHandsOff.ts\` / \`runtime/src/server/mcp/auraAgentMcpCall.mjs\` / \`runtime/src/server/connected/cognitiveQuestionToolbox.mjs\` / \`runtime/server.ts\` and their regression tests.

Only Aura owns the action/mission loop. Names inherited from previous architectures are historical source-file identifiers, not new agents.
