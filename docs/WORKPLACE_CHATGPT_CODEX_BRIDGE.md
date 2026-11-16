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

For the legacy Github-issue transport, the relay requires a GitHub token through
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


## Tokenless Git-ref transport for the public JACO repository

On the default public `Rick84444/JACO-CODE` repository, `auto` chooses the
**git-ref** transport even if a legacy GitHub token exists. The old authenticated
`github-issue` transport remains available explicitly for a suitable private repo.

The bridge uses the **existing** `chatgpt-jaco-relay` Workplace Agent Card,
session, sync/ACK, encrypted event log and normal permissions.

- Inbound: branch `jaco-chatgpt-in`, file `.jaco/chatgpt-in.json`, with exactly
  one operator-sent `jaco.chatgpt-workplace/v1` communication message.
- Outbound: branch `jaco-chatgpt-out`, file `.jaco/chatgpt-out.json`, created
  using a temporary Git index and a non-forced push.
- Only server-issued agent ID, input message ID, cursor, event kinds and body
  SHA-256 digests can appear in the outbound receipt. **Never export Workplace
  message text, URLs, references or session credentials to the public repo.**
- Local Git origin must match the configured repo. Existing Git credentials
  must permit status pushes. No API key, extra daemon or public port is added.
- Only communication events are allowed. The relay has no mission, approval,
  claim or deployment permissions; policy-bound Nova Git control is separate.
- After initial ref/network failures the process retries on its own, with Git
  polling spaced at least 30 seconds apart.

Example safe inbound payload:

```json
{
  "schema": "jaco.chatgpt-workplace/v1",
  "messageId": "chatgpt-workplace-git-handshake-20261116-v1",
  "kind": "QUESTION",
  "thread": "chatgpt",
  "targets": ["*"],
  "body": "Aura: acknowledge this non-sensitive handshake."
}
```

**Public-branch rule:** do not include secrets or private conversation text in
`jaco-chatgpt-in`. Outbound provides a verifiable hash/receipt, not a private
conversation channel. Use the separate authenticated private MCP tunnel for
confidential ChatGPT collaboration.

**Real Windows verification:** update the installed checkout without overwriting
uncommitted work, restart only Workplace through its normal supervisor, and
check `GET /health` for `chatgptRelay.transport=git-ref`,
`chatgptRelay.state=READY` and a real `agentId`. Then read
`jaco-chatgpt-out:.jaco/chatgpt-out.json` on GitHub, match `receivedId` to the
handshake, and verify a later response generates a distinct event-kind/body-hash
receipt. The source code alone does not establish a running local connection.


## Truth boundary

A READY relay means the transport is alive. It does not mean a ChatGPT model is
continuously thinking in the background.

A READY MCP agent means the MCP/Workplace client session is alive. It does not
prove every capability of the host coding tool.

Target-host verification requires all three observable facts:

1. the agent appears with a READY Workplace session,
2. a message crosses the Workplace event log,
3. the recipient reads it and posts a reply that crosses back.
