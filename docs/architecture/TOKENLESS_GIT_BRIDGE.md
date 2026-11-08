# JACO ↔ ChatGPT: Git bridge without API keys

This is an extension of **existing** Durable Nova / GitHub control inbox. It introduces no second agent, planner, browser controller, daemon, webhook, cloud API or payment dependency.

## User experience

ChatGPT creates a small JSON mission command in the existing Git ref `jaco-control`. The local supervised Nova process fetches the ref through regular Git, validates the request, starts (or resolves) a **durable mission**, and publishes bounded status through `jaco-control-status` when its existing Git credentials allow pushing.

Flow:

```text
ChatGPT GitHub connector / Git client
        │ commits .jaco/nova-control.json (branch jaco-control)
        ▼
JACO existing Nova supervisor → existing mission store → authorized tools / CDP
        │
        └── bounded acknowledgement → Git branch jaco-control-status
                                   .jaco/nova-status.json
        ▲
ChatGPT GitHub connector reads the status ref
```

## Prerequisites

- Internet/Git transport to the repository. **No LLM API key, GitHub REST API token, separate SaaS connector in JACO, or new port.** For a public repository, Git fetch can work anonymously; private fetch and **push of acknowledgements** require already configured ordinary Git credentials/SSH key. Remote write access cannot be bypassed.
- The running **local JACO Nova agent must execute the branch containing this change**. GitHub commits alone do not alter a running Windows/Android process.
- JACO's canonical supervisor, local model, mission store, tool permissions and CDP (if browser automation is needed) remain prerequisites for work. Git transport does not grant action authority.

## Configuration

Default: if JACO has no GitHub token in its environment, it already selects Git ref transport. Force Git-only even if `GH_TOKEN` is configured:

```text
JACO_GITHUB_CONTROL_TRANSPORT=git-ref
```

Set `JACO_GITHUB_CONTROL_REPO=owner/repository` only if not using the repository configured in the existing agent runtime. No API token needs to be generated. Ordinary Git origin must match the configured GitHub repository, otherwise outgoing status is denied.

The poll interval for Git-only mode is at least 30 seconds. A newly published mission is **not accepted** until the running local agent fetches and validates it.

## Command format

On branch `jaco-control` write `.jaco/nova-control.json`:

```json
{
  "schema": "jaco.nova-control/v1",
  "commandId": "gui-probe-20261021-01",
  "op": "mission.create",
  "goal": "Read the current repository status and report whether CDP is ready. Read only.",
  "allowedTasks": ["git-status", "health-check", "repo-list"]
}
```

Use a **new unique** `commandId` for each logical mission. Resubmitting the same ID in an active local mission store must not create duplicates. Supported existing operations are `mission.create` and `mission.resolve`. Do not use Git instructions to approve financial spend or bypass policy. An agent process that is offline cannot receive Git messages.

## Reply format

If the local Git push succeeds, branch `jaco-control-status` contains `.jaco/nova-status.json`:

```json
{
  "schema": "jaco.nova-control-status/v1",
  "transport": "git-ref",
  "authoritative": false,
  "entries": [
    {
      "commandId": "gui-probe-20261021-01",
      "operation": "mission.create",
      "missionId": "mission-example",
      "status": "ACTIVE",
      "phase": "READY",
      "turn": 1,
      "failures": 0,
      "receipts": 0,
      "closed": false
    }
  ],
  "publishedAt": "2026-10-21T19:00:00.000Z"
}
```

The above is an **illustrative schema**, not a claim about a live mission. It contains no goals, paths, URLs, images, tools' raw results, or credentials. `receipts` is a count, not proof of work; consult canonical JACO for actual evidence. Status can lag the runtime. Terminal status is not self-certification.

If a push fails (no Git credentials, offline, unexpected origin, branch race) JACO retains the local mission and its result. `githubControl.gitReceiptPushError` records a bounded error code and retry is deferred for 60 seconds. No forced push is performed. The bridge does not automatically expose the local result to ChatGPT when outgoing Git writes are unavailable.

## Architecture & security

- Git payloads are transport only. All execution goes through the existing Nova mission validation and policy gates. The CDP MCP facade remains authenticated, origin restricted and scoped to a pinned browser tab.
- The Git reply is built with a temporary index and Git object plumbing. It never checks out another branch or stages/modifies the operator's working tree, and never force-pushes.
- Only the matching GitHub origin is permitted. Remote status commits disclose only bounded metadata. Treat branch write permissions as part of the trust boundary. Anyone with write permission to `jaco-control` could submit an instruction subject to JACO policy.
- If the local repository is private, Git authentication is still required. **No remote protocol can offer authenticated write access without some credential already available.**

## Verification

Run from repository root:

```bash
node --test tests/nova/github-control-inbox.test.mjs tests/nova/git-control-receipts.test.mjs
```

Also run the repository's full tests and platform-specific gate before merging. End-to-end on the operator's actual Windows installation requires checking that the running process has reloaded this code and that the status ref receives a real receipt. A GitHub PR alone does not deploy the local runtime.
