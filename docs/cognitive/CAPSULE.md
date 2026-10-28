# JACO Cognitive Capsule v1 — agentens kopplade hemmapp

## Status

`IMPLEMENTED_LOCAL_SLICE`: Opt-in capability-attenuation, deterministic file binding, prompt and memory loading and skill metadata discovery. **Not** a production-ready permissions sandbox, memory index or skill executor. No model benchmark completed.

Existing JACO code already provides `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, daily files in `memory/` and the canonical `MissionClient` permission gate. This feature extends that SAME home. It does not introduce a competing memory database.

```
<state>/home/nova/
├── capsule.json                  # capsule identity and reduced tool allowlist
├── prompts/
│   └── IDENTITY.md               # editable prompt, context not permission
├── AGENTS.md                     # operator's existing agent instructions
├── SOUL.md                       # tone and boundaries
├── USER.md                       # user preferences
├── MEMORY.md                     # curated long-term memory (private runs only)
├── memory/
│   └── YYYY-MM-DD.md             # existing daily log
└── skills/
    └── code-review/
        └── SKILL.md              # Agent Skills-compatible metadata
```

## Turn on (operator-only)

```sh
node agents/lib/capsule-cli.mjs init nova
node agents/lib/capsule-cli.mjs show nova
```

The command initializes the **existing** Nova home (see `agentHomeDir()`). `capsule.json` is created with read-only task names by default: `repo-list`, `repo-read`, `git-status`. Enable additional actions only deliberately, after verifying the current mission and runtime gates. Init refuses to replace an existing capsule configuration; no silent upgrades.

## Capability formula

`effectiveTasks = mission.allowedTasks ∩ capsule.tools.allow − capsule.tools.deny`

The source of mission authority stays `MissionClient` / runtime. There is no `*` in capsule allowlists. The agent cannot give itself a new capability by editing a prompt, memory or `SKILL.md`. An unknown/invalid capsule fails closed, **unless no capsule exists**, in which case legacy behavior is preserved.

This is **defense in depth**, not a replacement for the canonical runtime tool executor. Remote MCP tools additionally need per-tool permission checks: allowing `mcp-call` permits the mission to invoke its approved catalog unless narrowed further at the MCP boundary.

## Trust and persistence

- ID is verified against the requested agent name; the mission ID is carried in the loaded binding. `fingerprint` identifies the effective configuration and identity prompt. It is NOT a signature; an operator-side signature/pinned policy version remains future work.
- Capsule instructions, skills and memory are untrusted **context**, never policy. Web pages and tool outputs must also be treated as untrusted. Avoid storing credentials; the existing secret-redaction path is used.
- Paths are fixed; symlinks and non-regular files are rejected for capsule metadata, identity and skill files. Config and prompt sizes are bounded to avoid unbounded context loading.
- Skills are advertised as name/description only. Activating a procedure remains managed by the existing Skill Runtime; the capsule does not execute arbitrary scripts.
- The existing `agent-home` module reads only curated/private memory and recent daily records, with a total context cap. Future structured memory should include provenance, independent evidence refs, TTL/supersession and poisoning review before promotion.
- Runtime restart: the home is persistent. The capsule has no independent mission store; Continuum and the mission ledger remain canonical.

## Wiring

`agents/hands-off-agent.mjs` uses `cognitive-capsule.mjs` in:

1. `assertTaskAllowed()` — legacy JSON task plans cannot execute capsule-forbidden tasks.
2. `callBrain()` — the planner sees the reduced allowlist, context and skill catalog.
3. `runAgentLoop()` — native tool schemas are restricted before model calls.
4. `agentIntroExtras()` — identity, memory and skill metadata enter the contextual packet.

The changes are **not** wired to every possible JACO executor or the standalone Continuum scheduler. Those integrations and multi-process transaction checks require further end-to-end testing.

## Required acceptance tests before production rollout

- Validate that alternate execution surfaces (Android, browser, gateway, MCP, other worker) cannot bypass the runtime authority and effective capsule tool allowlist.
- Pin capsule configuration to the active mission/worker epoch; reject stale token, owner crossover and unauthorized file changes.
- Reconcile durable unknown outcomes after process crashes without automatically repeating side effects.
- Test memory injection, prompt injection, cross-agent data isolation, clock drift, file races and malicious symlink replacement.
- Produce trace-backed acceptance evidence from a full code edit → test → review → memory promotion → resumed run.
