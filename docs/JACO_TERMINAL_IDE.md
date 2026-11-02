# JACO Terminal Cognitive IDE (local-first, Git + MCP + device pairing)

The terminal is an **operator client of the canonical JACO runtime**. It is not a second model executor, not a general shell, and it cannot bypass policy gates for agent tools. It reuses Aura chat, mission ingress, the established Git binary (as the local operator), the existing MCP setup installer, and JACO's existing device pair/join API.

## Start

From a terminal in the JACO-CODE checkout (Node.js 24+):

```sh
npm run jaco:ide
# or, when the root package binary is linked:
jaco ide --project /path/to/your/project
# open the terminal without starting services:
jaco ide --project /path/to/your/project --no-start
```

- **Windows:** double-click `JACO-Terminal.cmd` in the checkout to open a terminal window. It uses the existing JACO launcher and its configured runtime; it does not install or deploy another runtime.
- **Android / Termux:** after installing the canonical `runtime/bin/jaco` wrapper, run `jaco ide` (or `node agents/jaco-cli.mjs ide` in the checkout). Termux calls the existing supervised `jacoctl activate` path; the new CLI does not take over ports.
- **macOS/Linux:** run `node agents/jaco-cli.mjs ide`; `jaco` without args opens the terminal on an interactive TTY and retains `activate` behavior for non-interactive scripts.
- `/open` requests the existing browser IDE at the configured JACO runtime origin, without creating an additional server. `/code` requests that VS Code open the local project folder. A missing client does not mean JACO failed.

An activation receipt is displayed before the first prompt. If startup is DEGRADED/BLOCKED, the interactive client remains available for diagnostics; it never claims the runtime is READY.

## Operator workflow

```text
JACO | Terminal Cognitive IDE
Project: /workspace/my-app
Runtime: http://127.0.0.1:3000

jaco> /git status
jaco> /git log
jaco> /git diff
jaco> /git pr
jaco> Please review our last failing test.
jaco> /goal Fix the failing test and produce a verified receipt.
jaco> /missions
jaco> /mcp doctor
jaco> /mcp install vscode
jaco> /devices list
jaco> /devices invite pixel
jaco> /devices join https://my-hub.example
jaco> /code
jaco> /exit
```

Unprefixed sentences go through the existing `/api/aura/chat` route; `/goal` goes through the canonical durable mission entry. A successful POST only confirms acceptance; use `/missions` and actual receipts to establish completion. Model provider registration and budget enforcement remain owned by the runtime.

## Git integration

All Git operations run in the chosen **local** project folder with argument arrays, no shell interpreter. The runtime workspace configured inside the web IDE **may be different**; opening `--project` does not silently change server-side project ownership.

- **Read-only:** `/git status`, `/git branch`, `/git log`, `/git diff`, `/git pr` (`gh pr status` if installed).
- **Explicit write/remote actions:** `/git fetch`, `/git pull`, `/git sync`, `/git push`; each requires a prompt that includes the exact local branch.
- `/git pull` is **fast-forward only** and refuses uncommitted/untracked files and missing upstream. `/git sync` fetches and fast-forwards to the tracked upstream without rebase or merge commit. If remote history diverged, Git aborts.
- `/git push` refuses `main`, `master`, `production` and `release`; it never adds `--force` or pushes an arbitrary user-supplied ref. Authentication is provided by the user's local Git/GitHub credential manager, never pasted into an agent prompt or written to the repo.
- There is **no auto-push, auto-merge, silent stash, reset or destructive cleanup**. Agent-originated edits still require their own JACO mission contract and policy; a text message cannot invoke the operator's Git commands.

For mobile/local project sync, Git provides **versioned source synchronization** (explicit fetch/fast-forward) while JACO device pairing and Workplace handle **agent mission/state coordination**. Git is not a replication mechanism for private agent memory, browser sessions, secrets, untracked local files or SQLite databases.

## Connect VS Code, Claude Code or Codex using MCP

Inside `jaco ide` run `/mcp doctor`, then `/mcp install vscode`, `/mcp install claude` or `/mcp install codex`.

This uses the canonical `runtime/src/server/connected/connectionSetup.mjs` installer, creating an entry for `jaco-editor` without overwriting existing MCP servers and backing up existing files. It does **not** install models, run Codex/Claude as subagents, register paid API keys, or prove that VS Code has loaded the new MCP server. Restart the client and perform a real JACO tool call in the editor before reporting connectivity as verified.

VS Code's workspace `.vscode/mcp.json` and portable `.mcp.json` differ; the installer selects the correct schema per client. In remote workspaces, the MCP process runs where the workspace is opened; the configuration by itself does not move the runtime. See [Microsoft MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## Mobile and remote JACO

Use **existing** device registry and pairing, not a new socket or token store.

1. On the Hub, `/devices invite pixel` issues a one-use code valid for ten minutes.
2. On your phone/second computer, `/devices join https://hub.example` and enter the code. The CLI forwards the code to `tools/join-hub.mjs` over stdin rather than exposing it in process arguments.
3. The helper writes a per-device key to that device's private `.env` and verifies the authenticated hub endpoint. Start the local Nova executor through its existing supervisor.
4. `/devices list` on the Hub reports observed connection state. A successful join is **not** proof that a delegated agent task was executed; examine a real receipt.

Non-loopback runtime connections require HTTPS and existing gateway authentication. The CLI never creates a public tunnel or synchronizes private state through Git.

## Next release gates

- CI: tests for terminal command parsing, Git admission/cleanliness, explicit confirmation, one-time pairing over stdin, workspace MCP setup wiring, and Windows launch command; typecheck and full root tests.
- On Windows: `JACO-Terminal.cmd` in a real PowerShell/cmd session, JACO READY/DEGRADED classification, VS Code successfully calls a JACO tool, branch push requires interactive confirmation.
- On Android: `jaco ide` from Termux, successful one-time pairing, device heartbeat and a verified mission receipt.
- For public installers, update Windows Setup/Lite bundles explicitly. A merged source file is **not** a distributed binary or an installed Windows shortcut.

## Competitor architecture

Cursor's Grok Bot uses a persistent hosted computer, with apps/MCP, chat and mobile clients; Bots on one member's computer may share sessions. JACO's differentiator is **local-first operator ownership**, reproducible Git handoff, and verified role-bound execution rather than cloning its UI. Source: [Grok Bot overview](https://prod.cursor.com/docs/grok-bot) and [computer/accounts](https://docs.x.ai/grok-bot/computer-and-apps).
