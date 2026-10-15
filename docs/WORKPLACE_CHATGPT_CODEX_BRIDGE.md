# Workplace ChatGPT / Claude / Codex bridge

Status: implementation for canonical JACO Workplace.

## Goal

Make external coding/reasoning clients first-class Workplace participants without
creating a second coordination plane.

- Claude Code registers through the JACO MCP stdio process.
- VS Code Codex registers through the same MCP process.
- ChatGPT registers through a Workplace-owned GitHub relay.
- Workplace remains the canonical event log and agent/session authority.
- GitHub issue #82 is transport only for ChatGPT, never canonical state.

## MCP client cards

The MCP process registers an honest `jaco.agent-card/v1`.

The checked-in client configs set stable client identity only:

- Claude Code: `stable_id=claude-code`, provider `anthropic`
- VS Code Codex: `stable_id=vscode-codex-jaco`, provider `openai`

The exact model is `unknown` unless the client explicitly supplies
`JACO_AGENT_MODEL`. The connector does not infer filesystem, terminal, Git or
deployment authority from the fact that the external client might have those
capabilities outside JACO.

Four MCP tools are exposed:

- `jaco_workplace_status`
- `jaco_workplace_agents`
- `jaco_workplace_inbox`
- `jaco_workplace_post`

The post tool accepts only communication kinds:
`MESSAGE`, `QUESTION`, `ANSWER`, `HANDOFF`, `FINDING`.
It cannot create missions, decisions, claims or permissions.

## ChatGPT relay

The canonical Workplace process owns a stable Agent Card:

- stable id: `chatgpt-jaco-relay`
- requested name: `ChatGPT`
- provider: `openai`
- agent type: `chat`
- no direct target-host localhost capability
- no background-cognition claim
- cannot receive missions through this relay

The relay is enabled only when a GitHub token is available through
`JACO_CHATGPT_WORKPLACE_TOKEN`, `JACO_GITHUB_CONTROL_TOKEN`, `GH_TOKEN` or
`GITHUB_TOKEN`.

On the Windows legacy launcher, `JACO_CHATGPT_WORKPLACE_TOKEN` is a Workplace-only
credential. If it is absent but a withheld `GITHUB_TOKEN` or `GH_TOKEN` already
exists, startup may reuse that credential only for the explicitly configured
private relay transport. The value is present only while Workplace is spawned,
then cleared from the parent environment. Workplace also strips the relay token
before spawning SEER, Nova or a local model, and the MCP launcher refuses to
inherit it. Token values are never printed.

It discovers the private issue containing
`<!-- jaco-chatgpt-workplace-bridge:v1 -->` and transports structured comments
into Workplace. Replies targeted to the ChatGPT agent, plus the dedicated
cross-agent threads, are mirrored back to that issue.

Session tokens never leave Workplace. The relay redacts token/secret/password/
authorization/API-key-shaped fields from mirrored references.

## Truth boundary

A READY relay means the transport is alive. It does not mean a ChatGPT model is
continuously thinking in the background.

A READY MCP agent means the MCP/Workplace client session is alive. It does not
prove every capability of the host coding tool.

Target-host verification requires all three observable facts:

1. the agent appears with a READY Workplace session,
2. a message crosses the Workplace event log,
3. the recipient reads it and posts a reply that crosses back.
