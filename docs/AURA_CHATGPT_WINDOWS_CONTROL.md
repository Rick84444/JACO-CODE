# Aura control plane — this ChatGPT chat to JACO

## Scope and truth boundary

The GitHub issues marked `[JACO BOOT]` are **bootstrap-only**: `system.status`, `system.health`, `system.activate`, `system.restart` and `system.update` are fixed verbs. The receiver checks the issue creator and deduplicates command IDs. Do not add free-form shell, file writes, prompts, credentials, or a general MCP proxy to this channel.

The Windows receiver `runtime/bin/sentinel-windows.mjs` was committed in PR #66 and requires target-host validation; merge #66 before deploying this PR. No startup shortcut is installed by this PR.

MCP is the rich operating channel, protected by JACO Sentinel's existing bearer, host/origin checks, Core authentication and the per-tool/mission policies. Its availability from an external ChatGPT session requires an explicitly connected MCP client; a healthy Cloudflare Tunnel or a GitHub command receipt is not that proof.

## Additional MCP tools

| Tool | Behavior |
| --- | --- |
| `jaco_system_health` | Reads Core/Workplace/Durable Nova readiness through independent loopback probes |
| `jaco_mcp_catalog` | Reads the actual Core MCP host's tool catalog, status and agent-access policy |
| `jaco_mcp_read` | Calls an existing MCP tool with `mode=read`; the canonical Core denies writes |
| `jaco_shell_inspect` | Optional fixed, local read-only diagnostics using no command interpreter |

Shell inspector operations: `git_status`, `git_diff_stat`, `git_recent_commits`, `node_version`, `npm_version`. The inspector is off unless the Windows/Termux operator explicitly sets `JACO_MCP_SHELL_INSPECT=1` for the Sentinel process. It executes only fixed argv arrays, with a reduced child environment, 10 s timeout and bounded output.

**No arbitrary shell is provided here.** To execute mutating shell/code tasks, use the existing Aura mission/executor/approval path, then collect its verified receipt. Never bypass the runtime's signed mandates and scope policy by smuggling commands into GitHub issues.

All 35 existing JACO MCP tools remain available; the three MCP/shell tools and `jaco_system_health` bring the registered catalog to 39. Tool registration alone is not proof a provider or host capability is active.

## Public health receipts

When Sentinel's `system.status` or `system.activate` returns a real `jaco.activation/v2` report, only allowlisted state enums and counts are published into GitHub:
Core, Workplace, Durable Nova, planner, active tool count and aggregate health. Aura's direct operator chat is explicitly `NOT_INDEPENDENTLY_PROBED`.

If the Windows receiver returns only a short `{state:'READY'}` response, the issue reports `Service evidence: NOT_AVAILABLE`. This is **not** a verified Core/Workplace/Aura health check.

Do not post log text, command line, local paths, hostnames, provider names, credentials or raw runtime result objects in public issues.

## Cold-start truth and recoverable browser failure

Cold-start incident #69 proved that Core, Workplace, SEER, CDP-MCP and Chrome can all listen while `browser-attachment` is still `BLOCKED`. A successful TCP/HTTP probe, a `jaco.activation/v2` report with `ok:true`, or a listening Chrome port must **not** alone imply end-to-end `READY`.

The launcher now writes `jaco.local-startup/v1` with an explicit browser-attachment requirement. When Chrome itself fails to launch or attach:

- Core, Workplace and SEER may continue startup;
- `browserAttachment` is `FAILED` or `UNAVAILABLE`, and startup becomes `DEGRADED` rather than `READY`;
- local CLI status and ChatGPT bootstrap status reconcile with the durable startup checkpoint;
- only allowlisted state, attachment and phase enums enter public GitHub receipts;
- nonzero CLI exit codes containing valid JSON retain the structured report, without posting stdout/stderr.

A missing or legacy checkpoint with no browser-attachment proof is `UNVERIFIED`, **not** `READY`. An opt-out `JACO_ENABLE_CDP=0` may complete without browser attachment.

### Windows Continuum ledger owner verification

`events.lock` includes `processBirth` (Windows WMI process CreationDate) in addition to the existing Unix boot ID/start ticks. A legacy Windows lock with a live but reused PID is reclaimable only when the **current** process was born more than five seconds *after* the lock's `startedAt`. Unknown process start time, malformed legacy dates and ambiguous live owners remain locked. Only the lock file is eligible for replacement; ledger events are neither discarded nor rewritten. Never delete a live lock by hand.

### Merge and target-host verification

PR #60 fixes canonical `main` update flow. PR #66 adds the Windows receiver. This PR adds end-to-end readiness evidence and Windows ledger fixes. Keep each suite's `test:unit` entries when integrating; do not discard the PR #66 Node-CLI regression.

After CI and controlled integration, explicitly verify on the Windows target:
- stop the stack while retaining exactly one Sentinel;
- command `system.activate` and confirm Core/Workplace/SEER operate even if Chrome is deliberately unavailable;
- verify the command receipt is `DEGRADED` whenever browser attachment fails;
- verify an **authenticated** browser attachment to the dedicated Chrome profile succeeds and the durable startup checkpoint is `READY` before claiming full readiness;
- simulate a stale Windows ledger PID (process born after the old lock) in an isolated temporary ledger only; verify a live matching owner is never evicted;
- test Sentinel autostart only after operator installation, without replacing the current service session.

Do not retry an incomplete activation while it is still marked RUNNING. Never trigger an unapproved live Chrome restart/attachment as part of a code-only PR.

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
