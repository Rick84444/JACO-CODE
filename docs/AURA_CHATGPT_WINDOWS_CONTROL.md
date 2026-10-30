# Aura control plane — this ChatGPT chat to JACO

## Scope and truth boundary

The GitHub issues marked `[JACO BOOT]` are **bootstrap-only**: `system.status`, `system.activate`, `system.restart` and `system.update` are fixed verbs. The receiver checks the issue creator and deduplicates command IDs. Do not add free-form shell, file writes, prompts, credentials, or a general MCP proxy to this channel.

The Windows receiver `runtime/bin/sentinel-windows.mjs` must first be committed from the Windows workstation and verified on its real host. The public repository does not yet contain it; no startup shortcut is installed by this PR.

MCP is the rich operating channel, protected by JACO Sentinel's existing bearer, host/origin checks, Core authentication and the per-tool/mission policies. Its availability from an external ChatGPT session requires an explicitly connected MCP client; a healthy Cloudflare Tunnel or a GitHub command receipt is not that proof.

## Additional MCP tools

| Tool | Behavior |
| --- | --- |
| `jaco_mcp_catalog` | Reads the actual Core MCP host's tool catalog, status and agent-access policy |
| `jaco_mcp_read` | Calls an existing MCP tool with `mode=read`; the canonical Core denies writes |
| `jaco_shell_inspect` | Optional fixed, local read-only diagnostics using no command interpreter |

Shell inspector operations: `git_status`, `git_diff_stat`, `git_recent_commits`, `node_version`, `npm_version`. The inspector is off unless the Windows/Termux operator explicitly sets `JACO_MCP_SHELL_INSPECT=1` for the Sentinel process. It executes only fixed argv arrays, with a reduced child environment, 10 s timeout and bounded output.

**No arbitrary shell is provided here.** To execute mutating shell/code tasks, use the existing Aura mission/executor/approval path, then collect its verified receipt. Never bypass the runtime's signed mandates and scope policy by smuggling commands into GitHub issues.

All 35 existing JACO MCP tools remain available; these 3 additions bring the registered catalog to 38. Tool registration alone is not proof a provider or host capability is active.

## Public health receipts

When Sentinel's `system.status` or `system.activate` returns a real `jaco.activation/v2` report, only allowlisted state enums and counts are published into GitHub:
Core, Workplace, Durable Nova, planner, active tool count and aggregate health. Aura's direct operator chat is explicitly `NOT_INDEPENDENTLY_PROBED`.

If the Windows receiver returns only a short `{state:'READY'}` response, the issue reports `Service evidence: NOT_AVAILABLE`. This is **not** a verified Core/Workplace/Aura health check.

Do not post log text, command line, local paths, hostnames, provider names, credentials or raw runtime result objects in public issues.

## Windows per-user autostart (explicit opt-in)

After the Windows receiver file exists locally and has been independently verified, run this on that workstation from the checkout root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File runtime/scripts/windows/Jaco-SentinelStartup.ps1 -Status
powershell -NoProfile -ExecutionPolicy Bypass -File runtime/scripts/windows/Jaco-SentinelStartup.ps1 -Install
```

To disable:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File runtime/scripts/windows/Jaco-SentinelStartup.ps1 -Remove
```

This creates a single per-user Startup shortcut with the detected Node executable and this repo's receiver path, if the receiver exists. It does not change Windows services, UAC, registry, Task Scheduler, or the JACO `.env`. An existing shortcut for a different receiver is not overwritten or removed.

### Required target-host acceptance

1. Start the receiver locally with no Core or Workplace running.
2. Issue a fresh `system.status` and require a real reply.
3. Issue `system.activate` and verify the Core identity on `127.0.0.1:3000`.
4. Verify Workplace `/health` at `127.0.0.1:2995`, including its supervised Aura/Durable Nova states.
5. Verify MCP authentication and actual calls: unauthenticated denied; credentialed read allowed; write denied by policy; arbitrary shell denied.
6. After **user-enabled** Windows autostart, reboot, check the receiver's real process ownership and repeat steps 2–5.
7. Confirm failed or unknown results do not claim `READY` and do not silently retry non-idempotent mutations.

A green GitHub CI test is not a substitute for these Windows acceptance receipts.
