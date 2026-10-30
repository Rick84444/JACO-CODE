# Aura runtime control plane — evidence-first hardening (2026-10-30)

## Product contract

**Aura is the only operator-facing agent**, not the only operating-system process.
Core, Workplace, SEER and Durable Nova still own their established state, leases,
recovery and evidence. This change does not spawn a second supervisor or migrate
mission IDs, memory, approvals, vault material or ledger storage.

The canonical source is `Rick84444/JACO-CODE` (`main` after review).
An older `JACO-Autonomus-IDE` PR #181 contained a CDP readiness idea,
but its open status did not deploy it into this repository.

## Actual integration

- `GET /api/aura/workbench/agent-board` now incorporates the same bounded,
  read-only service observations as Aura's `health` tool. The operator view
  displays policy-disabled, unreachable, discoverable and verified states separately.
- `aura_runtime` is an **on-demand, read-only** chat tool over this existing
  board, not a new agent, loop, lease, capability grant or MCP execution path.
  `aura_functions` remains a static function contract.
- The UI exposes active, blocked and awaiting-verification mission counts plus
  uncertain outcomes in the visible mission window. These counts are not claims
  of end-to-end mission success.
- The health source returns only bounded states, never raw WebSocket URLs,
  gateway credentials, authorization headers or environment files.
- Aura Lean skips passive polling of deliberately disabled CDP adapters and
  disabled Ollama. A displayed DISABLED state is *configuration intent*, not proof
  that no stale process is listening.

## CDP fail-closed boundary

```text
Aura operator -> MCP 2996 (health)
                    |
                    v
            Nova Bridge 4243 (Bearer)
                    |
              Workplace authority
                    |
          CDP discovery 127.0.0.1:9222
                    |
            DevTools page WebSocket
                    |
          Runtime.evaluate('1+1') = 2
                    |
            short-lived receipt
```

- CDP HTTP discovery alone is `DISCOVERABLE`, never READY.
- A live Nova bridge requires a real CDP WebSocket response and allowed
  Workplace authority before returning HTTP 200 and `browserVerified:true`.
- MCP requires Nova's fresh attestation (`verifiedAt`, age ≤ 4000ms), returns
  HTTP 503 otherwise, and rejects legacy `200 ok:true` without evidence.
- An expired or missing receipt must not silently fall back to READY.
- A bounded one-in-flight background probe prevents a slow Android WebSocket
  from stalling 1–2 second health polling clients.
- Browser target URLs are restricted to loopback; this does not assert that
  ordinary Android Chrome exposes TCP 9222 to Termux.
- All probes are read-only, do not create tabs or navigate pages. Actual browser
  mutations still use existing origin/policy/mission authorization paths.

## Current cleanup versus follow-up

Done in this branch:
- Remove false-positive browser health semantics (status 200 is not evidence).
- Collapse browser readiness into the existing Aura control plane, no new daemon.
- Avoid idle health probes for intentionally disabled adapters.
- Remove duplicated Aura workflow path declarations.
- Regression tests for failed WebSocket/evaluation, expired receipts, legacy
  HTTP 200, Lean configuration and read-only oversight.

Already completed in prior PR #54:
- Retire unsafe legacy plan mutation and direct shell execution routes with
  HTTP 410; preserve historical reads and durable receipts.

**Not done**: deleting SEER/Nova/Workplace technical processes, deleting
historic mission data, changing secrets, enabling Chrome on Android,
automatically activating the disabled CDP services, or replacing existing
mission-contract ownership. Those would be different migrations with device
evidence, explicit authority and rollback.

## Validation gates

On exact branch/commit:
```bash
node --experimental-sqlite --test \
  tests/nova/aura-cdp-truth.test.mjs \
  tests/nova/aura-oversight.test.mjs \
  tests/nova/cdp-mcp.test.mjs \
  tests/nova/bridges.test.mjs \
  tests/nova/aura-termux-service-health.test.mjs \
  tests/nova/aura-single-agent-functions.test.mjs
```

Then CI build/TypeScript and **host-specific** Termux acceptance:

1. A deliberately disabled browser cannot produce MCP/Bridge READY.
   If Aura Lean keeps both bridge services DOWN, distinguish intentional
   disablement from a tested HTTP 503; do not claim the latter occurred.
2. After explicitly enabling an existing supervised browser transport,
   verify a real WebSocket `Runtime.evaluate('1+1')=2`, fresh Nova
   `/health` HTTP 200 + Workplace READY, and MCP HTTP 200 + attestation.
3. Stop/disconnect the DevTools transport; after receipt expiration, both
   bridges must fail closed, not retain an old 200.
4. Verify ten real Aura turns and one completed durable mission on the Pixel
   with authentic receipts, bounded RSS and no duplicate runit process owners.
   This cannot be inferred from unit tests or GitHub CI.

No automatic Termux restart, installation, merge or deployment is part of
this branch. Do not modify `.env`, Vault, mission ledgers or stored receipts.
