# Aura single-agent architecture (first migration increment)

## Decision

Aura is the **only operator-facing agent identity**. Existing SEER and Nova
are implementation details exposed as Aura functions. The operator gives goals
to Aura, not to a roster of competing personalities.

```text
                         Operator
                            |
                           Aura
             one dialogue / goal authority / UX
                            |
        +----------+--------+---------+---------+
        |          |        |         |         |
      Reason      Plan     Execute   Memory    Verify
      model       SEER     Nova      Workplace receipts
                    \         |        /
                     MCP tools on demand
```

### Function contracts

| Aura function | Existing owner | Evidence boundary |
| --- | --- | --- |
| `reason` | SEER + selected local model | Do not claim inference without observed model response |
| `plan` | SEER Strategic Governor | Active strategy goal != dispatched plan |
| `execute` | Durable Nova | Accepted/queued != executed; require action receipts |
| `memory` | Workplace and canonical memory stores | Store session/event state; no secret storage in prompts |
| `tools` | Existing MCP fabric | READY != tool invoked; apply authority gates |
| `verify` | Mission/contract/evidence ledger | Step receipts != end-to-end goal acceptance |

## Delivered in the first increment

- One Aura function list in the existing agent-board API, preserving its legacy
  `agents`, `missions`, `network`, graph references and receipt fields.
- Aura functions as the default operator UI; technical registered clients and
  legacy process/session identities remain inspectable.
- Aura's existing chat prompt now treats internal roles as **functions**,
  not separately empowered agent personas.
- Read-only `aura_functions` chat tool introspects function contracts without
  registering additional agents or granting permissions.
- No state migration, data deletion, secret duplication, operator impersonation,
  authority bypass, new model connection or new background scheduler.

## Explicitly NOT delivered

This first increment **does not** move SEER, Nova and Workplace into one
operating-system process, and does **not** reduce their memory footprint.
`runtimeConsolidated: false` is required by the API.

Do not kill the current SEER or Nova services as part of an interface rename.
They currently own durable graphs, execution leases, retries and evidence.
The core must never silently fabricate a READY function when those services
are down.

## Optional resource-reduction profile (Termux)

`JACO_AURA_LEAN=1` is the new Termux default. Older installations with an
explicit value in the existing mode-600 `~/.config/jaco/runtime.env` retain
that value. Change the profile only through the canonical
`runtime/bin/jacoctl activate` or `restart` **when runit supervision is
healthy and interrupting any active mission is acceptable**.

When enabled:
- Core sets `JACO_AUTO_START_TOOLS=0`. The existing MCP catalog and policy
  stay intact; the named server is started lazily when explicitly used.
- `jacoctl` holds the auxiliary CDP (:2996) and Nova Browser Bridge (:4243)
  services down, even if the ordinary CDP setting defaults to enabled.
- Workplace/SEER/Nova continue their canonical durable responsibilities.
  No new scheduler or parallel background agent is created.
- Ollama remains available as an operator-selected fallback so a failing Gemma
  does not automatically leave Aura without inference.

Setting `JACO_AURA_LEAN=0` restores the ordinary startup behavior on the
next deliberate activation/restart. It does not destroy configurations or
delete models. A genuine one-process consolidation is **not** implied.

## Subsequent migration gates

1. Measure on-device memory, crashes, service lifecycle and real chat completions
   under a fixed task workload (Termux/Pixel).
2. Replace direct SEER/Nova client calls with **Aura capability adapters** that
   enforce the exact existing tokens, leases, receipts and policy contracts.
3. Make SEER/Nova services optional **only after** equivalent in-process adapters
   pass fault-injection, restart/recovery, receipt/evidence and multi-session tests.
   Preserve legacy mission IDs and ledger paths. Never replay ambiguous writes.
4. Add a truly lean Termux runtime profile with a single model loaded at a time,
   lazy MCP tools and CDP/remote adapters started only when needed.
5. Require physical 10+ chat turns and one verified mission on the device with
   no phantom processes/port conflicts before setting `runtimeConsolidated: true`.

The central distinction is **one agent identity** now versus **one OS process**
after a separate, explicitly verified migration. The latter cannot be assumed.


## 2026-10-30: Runtime debt reduction (Aura Lean default on Termux)

This is **runtime resource debt** removal, not indiscriminate deletion of source.
A file removed from Git does not by itself reduce resident memory or process count.

- New Termux installs default to `JACO_AURA_LEAN=1`. An existing explicit
  `JACO_AURA_LEAN=0` remains authoritative. `jacoctl` preserves the operator's
  explicit choice in the private mode-600 runtime environment.
- The old `startWorkerLoop` was already a deprecated no-op but was still
  imported and called on every Core boot; the boot call and its obsolete
  module import were removed. The compatibility status endpoint reports
  `isRunning:false` rather than inventing a functional worker.
- The legacy `autonomousHeartbeat` loop (its own plan/command execution
  authority) no longer auto-starts in Lean. Its model-pool / market-watch /
  command-executor module tree is now **dynamically imported** on explicit
  legacy endpoint use instead of every Aura/Core boot. Its historical plans,
  signoff API and explicit legacy endpoints remain intact pending migration.
- Durable Mission Bus keeps its canonical leases, receipts and owner.
  Its idle dispatcher cadence defaults to 5 seconds in Lean (1.2 seconds
  in full mode); overlapping ticks are suppressed in both modes.
- Automatic provider/MCP discovery runs every 180 seconds in Lean (30 seconds
  in full mode), with an initial and operator-triggered refresh still possible.
  Passive provider model-list checks reuse a 60-second observation cache and
  coalesce simultaneous requests. Explicit probes remain fresh and timestamps
  reflect when data was *actually* observed.
- Workplace LiteRT model probes allow up to 8 seconds in Lean rather than
  2.5 seconds; probe retries back off and supervisor restart retries are
  exponential (capped at 60 seconds), not unbounded 2-second crash storms.
  The real Nova/SEER startup inference check is **not** removed.
- Automatically discovering a 27B llama.cpp model does not silently replace
  the operator's preferred model in Lean when Gemma takes too long to answer.
  An explicit llama.cpp selection remains possible.
- Optional CDP/MCP background processes remain opt-in/lazy. Dormant large
  UI panels are loaded only when opened.

### Evidence and limitations

The source/CI checks verify code contracts, not observed RAM savings on the
operator's Android device. For a device baseline and comparison use the
**read-only** command `bash runtime/termux/aura-footprint.sh` before and after
a deliberate, supervised activation. It prints canonical JACO process labels
and resident memory (VmRSS KiB); the sum double-counts shared pages and is
not equivalent to PSS or proof of an Android low-memory kill.

The Core / Workplace / SEER / Durable Nova boundaries are not yet a single OS
process. Replacing those processes requires lease, evidence, memory migration
and failure-recovery tests. Do not remove or rewrite the existing mission
database, ledger, approval policies, identity/token store or `.env`.

Rollback to the full startup behavior is an explicit
`JACO_AURA_LEAN=0` in `~/.config/jaco/runtime.env`, followed by a **planned**
canonical activation/restart only when runit is healthy and active missions
can safely be interrupted. No auto-repair or port takeover is added here.
