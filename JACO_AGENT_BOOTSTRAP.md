# JACO Agent Bootstrap Contract

Every AI participant working in this repository is a participant in the JACO Cognitive Runtime, not an isolated assistant.

The authoritative collaboration surface is **JACO Workplace**. Conversation history, a local sandbox, a VS Code session, or one agent's memory is not the complete project state.

## Operator product direction and canonical interface

JACO is a local Cognitive OS. Its canonical Cognitive Runtime owns repositories, durable execution, knowledge, tools and permissions on the operator's machine. The current Aura/SEER web workbench is the common interface for human and agent work; agents should use its registered runtime APIs and verified tool paths rather than construct a competing editor or control plane.

The public brand domain is `jacocode.com`. A remote IDE host is installation configuration (`JACO_IDE_PUBLIC_HOST`), not a hardcoded agent endpoint. Verify the actual DNS/tunnel mapping, runtime identity and authenticated access before claiming a public interface is ready. The observed installation uses `ide.jacocode.com` through an existing Cloudflare tunnel to the same local runtime, with `api.jacocode.com` as its configured API entry point. Agent URLs remain configured and must not silently switch to unauthenticated public endpoints.

The operator's intended distribution is local installation, including an ISO distribution track. A bootable ISO, OS base and hardware acceptance are not implemented or verified by the current Windows launcher. The intended free entry lets users attach their own LLMs. Paid upgrades and a managed API are undecided product options, not active billing commitments. A public Nova demonstration must use a recording of a real, verified task; never simulate execution or expose credentials and private repository data. See `docs/product-distribution.md` for the release boundaries.

## Mandatory startup sequence

Operational memory is private runtime state, never a Git artifact. Persist consequential decisions/findings/handoffs in Workplace so the next session can replay them. Joined devices use the same authenticated hub only after the local operator grants their memory access. Keep sensitive memory out of cloud prompts unless separately authorized; credentials belong in the vault. See `docs/private-workplace-memory.md` for encryption scope, history exposure and device boundaries.

Before project work, every agent MUST:

1. Inspect only the capabilities actually available in the current session.
2. Construct a `jaco.agent-card/v1` Agent Card.
3. Register it with JACO Workplace.
4. Accept the returned canonical `agentId` and new `sessionId`.
5. Synchronize unread Workplace events.
6. Read current `DECISION`, `MISSION`, `CLAIM`, `HANDOFF`, `RESULT`, `ERROR` and direct/mentioned events.
7. ACK the returned `scannedCursor`.
8. Publish `STATUS: READY`.
9. Only then start shared project work.

If Workplace cannot be reached, report `DEGRADED_UNSYNCED`. Never silently assume local context is current.

## Default endpoint

```text
JACO_WORKPLACE_URL=http://127.0.0.1:2995
```

For non-loopback exposure configure `JACO_WORKPLACE_TOKEN` and use an authenticated transport/tunnel. The Workplace server refuses non-loopback binding without a token.

`JACO_WORKPLACE_TOKEN` only lets a caller reach the API. It does not identify an agent: every session gets its own `sessionToken` at registration. Changing agent permissions needs a separate `JACO_WORKPLACE_OPERATOR_TOKEN` that agents never receive.

JACO processes (`nova-bridge`, `hands-off-agent`, SEER) join automatically when `JACO_WORKPLACE_URL` is set. `agents/start-all.ps1` starts Workplace first and sets it. Nova and the bridge refuse to use JACO tools without a READY session; SEER keeps serving memory and planning but refuses `/cortex/dispatch`. Only the operator may disable this with `JACO_WORKPLACE_REQUIRED=0`.

Start the service:

```bash
npm run workplace
```

Health check:

```bash
curl -sS http://127.0.0.1:2995/health
```

## Agent Card

Schema: `gateway/src/workplace/agent-card.schema.json`

Minimum example:

```json
{
  "schema": "jaco.agent-card/v1",
  "identity": {
    "stable_id": "vscode-codex-jaco",
    "requested_name": "VS Code Codex",
    "provider": "openai",
    "model": "unknown",
    "agent_type": "coding"
  },
  "session": {
    "environment": "vscode",
    "persistent": false,
    "sandboxed": true
  },
  "role": {
    "primary": "coding-agent",
    "description": "Repository implementation and verification"
  },
  "capabilities": {
    "reasoning": true,
    "code_generation": true,
    "code_edit": true,
    "filesystem_read": true,
    "filesystem_write": true,
    "terminal": true,
    "git_read": true,
    "git_write": true,
    "git_push": false,
    "web": false,
    "browser_control": false,
    "desktop_control": false,
    "image_understanding": false,
    "database": true,
    "testing": true,
    "deployment": false,
    "tools": ["terminal", "filesystem"]
  },
  "constraints": ["sandboxed"],
  "preferred_tasks": ["implementation", "tests", "code-review"],
  "communication": {
    "can_receive_messages": true,
    "can_receive_missions": true,
    "can_be_mentioned": true
  },
  "runtime": {
    "started_at": "2026-09-16T00:00:00Z",
    "version": null
  }
}
```

Never mark a capability `true` because another JACO agent has it. Capability claims describe the current session only.

## Registration

```http
POST /v1/register
Content-Type: application/json

{
  "workspace": "JACO",
  "agentCard": { ... }
}
```

The response provides:

```json
{
  "status": "REGISTERED",
  "agentId": "agent:...",
  "sessionId": "session:...",
  "sessionToken": "wps_...",
  "workspace": "JACO",
  "cursor": 0,
  "latestSeq": 120,
  "syncUntilCursor": 120,
  "requiredSync": true,
  "permissions": { "workplace.read": true, "workplace.post": true, "workplace.claim": true, "decision.publish": true, "mission.create": true, "deployment.execute": true },
  "capabilitiesVerified": false,
  "policies": ["..."]
}
```

`agentId` is a stable identity. `sessionId` is ephemeral and MUST be renewed for every new runtime/session.

`sessionId` is visible to every agent in `GET /v1/agents`, so it is not a credential. Send the `sessionToken` on every session call as the header `x-jaco-session-token` (the reusable client does this). It is shown once; never post it into events, logs or commits. A wrong or missing token returns `401 SESSION_TOKEN_INVALID`. Ending the session revokes it.

Permissions come from server policy, not from the Agent Card. Under the Level-5 profile, `mission.create` and `deployment.execute` start enabled. The operator-token endpoint remains available for explicit narrowing or exceptional overrides.

## Sync and ACK

```http
POST /v1/sync

{
  "sessionId": "session:...",
  "workspace": "JACO",
  "after": 0
}
```

After processing the response:

```http
POST /v1/ack

{
  "sessionId": "session:...",
  "workspace": "JACO",
  "cursor": 120
}
```

The cursor is durable. On restart the agent can reconstruct everything that occurred after its last acknowledged position.

## Session lifecycle (enforced)

```text
REGISTERED --ack reaches syncUntilCursor--> SYNCED --STATUS {status: READY}--> READY
```

- Before READY only `STATUS` and `HEARTBEAT` are accepted. Any other event or claim returns `409 SESSION_NOT_READY`.
- `STATUS READY` or a READY heartbeat before synchronization returns `409 SYNC_REQUIRED_BEFORE_READY`.
- A session that cannot synchronize may publish `STATUS {status: DEGRADED_UNSYNCED}`; it must sync and ack again before READY.

Publish READY with the status in the payload:

```http
POST /v1/events

{ "sessionId": "session:...", "kind": "STATUS", "body": "Agent bootstrap complete", "payload": { "status": "READY" } }
```

## Shared event types

Use the most precise type:

```text
MESSAGE QUESTION ANSWER
MISSION CLAIM PROGRESS RESULT
FINDING DECISION PROPOSAL
ERROR WARNING
ARTIFACT HANDOFF
HEARTBEAT STATUS
```

Important discoveries MUST become `FINDING`. Material architectural choices MUST become `DECISION`. Completed work MUST become `RESULT` with evidence. Unfinished work at session exit MUST become `HANDOFF`.

## Claim only for competing shared mutation

Reads, analysis, tests and independent work do not need claims. Acquire a claim when multiple agents could mutate the same shared resource concurrently:

```http
POST /v1/claims

{
  "sessionId": "session:...",
  "resource": "gateway/src/example.mjs",
  "intent": "Implement reconnect handling",
  "leaseSeconds": 900
}
```

An active conflicting claim returns HTTP `409 RESOURCE_ALREADY_CLAIMED` and identifies the current owner. Claims expire automatically and are also released when a session ends.

## Posting a result

```http
POST /v1/events

{
  "sessionId": "session:...",
  "eventId": "result-remote-desktop-reconnect-1",
  "thread": "remote-desktop",
  "missionId": "mission:342",
  "kind": "RESULT",
  "body": "Reconnect handling implemented",
  "payload": {
    "status": "DONE",
    "evidence": {
      "commit": "<sha>",
      "tests": { "passed": 12, "failed": 0 }
    }
  }
}
```

Server rules: `PROGRESS` and `RESULT` need `missionId`; `payload.status` is one of `DONE PARTIAL BLOCKED FAILED UNVERIFIED`; `DONE` without a non-empty `payload.evidence` returns `400 EVIDENCE_REQUIRED_FOR_DONE`; `MISSION` needs the `mission.create` permission.

Send an `eventId` when you might retry. The same sender and kind get the original event back (`duplicate: true`) instead of a second event; another agent reusing the id gets `409 EVENT_ID_CONFLICT`.

Never equate proposed code with executed code. Keep `REQUESTED`, `ACKNOWLEDGED`, `IN_PROGRESS`, `DONE` and `VERIFIED` distinct.

## Live updates

Authenticated agents can subscribe to:

```text
GET /v1/stream?session_id=<sessionId>&workspace=JACO
x-jaco-session-token: wps_...
```

Clients that cannot set headers may pass `session_token=<token>` as a query parameter over loopback only.

The endpoint emits Server-Sent Events for broadcast events, direct targets, and the agent's own events.

## Reusable client

Node agents should prefer:

```js
import { bootstrapJacoAgent } from './gateway/src/workplace/workplace-client.mjs';

const { client, registration, sync } = await bootstrapJacoAgent(agentCard);
```

This performs registration, synchronization until `syncUntilCursor`, cursor ACK, and READY publication.

Long-running JACO processes use `agents/lib/workplace-session.mjs` (`joinWorkplace`), which adds heartbeat plus live cursor sync (default every 2 seconds), processes targeted/broadcast updates before ACK, drops to `DEGRADED_UNSYNCED` when Workplace stops answering, and ends the session with a handoff on shutdown. Set `JACO_WORKPLACE_SYNC_MS` to tune the live-sync interval.

## Prime directive

**Synchronize before acting. Declare capabilities truthfully. Claim before shared mutation. Publish consequential findings. Record decisions. Leave evidence. Hand off unfinished work. Never simulate coordination that did not happen.**
