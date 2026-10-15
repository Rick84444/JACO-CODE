# Canonical MCP connection and agent continuity

JACO already has one canonical MCP path. Do not create another MCP server,
second agent registry, or chat-memory store just because a client is not
immediately visible in the UI.

```text
MCP client (VS Code / Claude Code / future ChatGPT Workspace app)
        ↓  standard MCP tools
JACO MCP launcher or Sentinel /mcp endpoint
        ↓  authenticated local API calls
JACO Runtime + Workplace
        ↓
SEER / Nova durable goals, missions, receipts and evidence
```

The active implementation is split deliberately:

| Owner | Responsibility |
| --- | --- |
| `.mcp.json` and `.vscode/mcp.json` | Checked-in local MCP client entry points and stable client identities |
| `runtime/tools/jaco-mcp-launch.mjs` | Starts the canonical stdio MCP server for local clients |
| `runtime/gateway/src/mcp-stdio.mjs` | stdio MCP process and Workplace registration |
| `runtime/gateway/src/sentinel.mjs` | HTTP MCP endpoint at `/mcp`; loopback by default |
| `gateway/src/workplace/` | Canonical Agent Cards, sessions, event log and cross-agent communication |
| `gateway/src/seer.mjs` and Nova | Durable execution, recovery and verified receipts |

### Permissions

The MCP server exposes named semantic tools, not an unrestricted shell. This is
intentional: tools can be audited, validated and tied to receipts.

- Read tools expose runtime, Workplace, mission, provider and receipt state.
- Existing write tools remain constrained by the relevant mandate, schema and
  downstream verification contract.
- `jaco_system_update` is the only Git update tool. It performs
  `fetch origin master` followed by `merge --ff-only origin/master`, only when
  the target checkout is clean and currently on `master`.
- Git update is opt-in with `JACO_MCP_ALLOW_UPDATE=1`. It is intentionally
  separate from `JACO_MCP_ALLOW_ACTIVATION=1`.
- No MCP tool grants raw shell execution or returns credentials.

`master` remains the canonical integration branch. A feature checkout may use
the MCP tools for development and tests, but `jaco_system_update` will refuse
to change it until its work is integrated into a clean `master` checkout. Do
not force a branch switch around uncommitted work.

### What continuity means

A stable `JACO_AGENT_STABLE_ID` makes reconnecting clients recognizable in
Workplace. Workplace retains the canonical communication events and SEER/Nova
retain durable goals and missions. A `READY` MCP session is only evidence that
the connector is alive now; it is **not** evidence that a hosted model is
running or thinking in the background.

For a normal chat client, the durable pattern is:

```text
Chat turn → authenticated MCP call → Workplace event / durable mission
        → verified result or receipt → later chat reconnects and reads it
```

This lets a later chat continue from JACO-owned evidence without claiming that
ChatGPT itself persists as a background agent. The existing
`jaco_workplace_status`, `jaco_workplace_agents`, `jaco_workplace_inbox` and
`jaco_workplace_post` tools are the connection surface for that continuity.

### ChatGPT Workspace / normal-chat boundary

Local VS Code and Claude Code clients can spawn the stdio MCP launcher.
ChatGPT in ordinary chat needs the same MCP tools through the Sentinel HTTP
endpoint plus a public HTTPS address and OAuth user authentication. Do not
make `/mcp` anonymously public or reuse the local JACO gateway token as a
ChatGPT credential. Until that OAuth/public endpoint is configured, ChatGPT
can participate through the existing Workplace relay but is not a direct
normal-chat MCP client.
