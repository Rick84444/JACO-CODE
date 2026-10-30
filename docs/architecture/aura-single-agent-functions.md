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
