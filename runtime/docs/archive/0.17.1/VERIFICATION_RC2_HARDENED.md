# RC2 — A2A hardening restored

RC2 as received had regressed on security while the frozen gate still reported
49/49 green. This documents what was found, what changed, and what was actually
observed rather than asserted.

Input integrity: the received archive matched its published digest
`879ddf24c5bbbe91b1d0f20b6e772117e6733a220b959aa57d727e8ad24abfba`.

## What the frozen gate did not catch

`FROZEN_RELEASE.json` records `semanticTypecheck: NOT VERIFIED`, and the frozen
suite is `verify_frozen_hands_off.mjs` plus `verify_truthful_runtime.mjs`. Those
check syntax, strings and truth claims. They do not check whether a module is
dangerous, so the following passed the gate:

| Finding | Location in RC2 as received |
|---|---|
| Remote code execution: peer-supplied code compiled into the host realm | `src/server/a2a/skillStore.ts:142` |
| Reachable from HTTP with no auth middleware | `server.ts:651` install → `server.ts:2289` execute |
| Node identity not verifiable — `Math.random()` | `src/server/a2a/nodeRegistry.ts:27` |
| Autonomous payment loop started by module import | `autonomousSalesOrchestrator.ts:58` |
| Fabricated counters under a `[REAL]` header | `autonomousSalesOrchestrator.ts:36` |
| Approval gate reduced to a filename regex — no boundary, no contract | `src/server/gate/approvalGate.ts` |
| Workspace boundary module absent from the tree | `src/server/security/workspaceBoundary.ts` |
| All seven hardened A2A modules and their 47-check suite absent | `src/server/a2a/`, `scripts/` |

Nothing here indicates carelessness. `server.ts` grew from 231 lines in 0.17.0 to
10,849 in RC2; a merge that took the archived prototype and dropped the hardened
replacements looks entirely reasonable while it is happening. That is precisely
why the gate has to test for it.

## What changed

- **`skillStore.ts` rewritten.** Same exported signatures, so `a2aExecutor.ts`
  and `server.ts` compile untouched. Underneath: install stages a package as
  UNVERIFIED and non-executable; execution runs on a worker thread in a fresh
  `vm` context with no `require`, `process`, `fetch` or timers, code generation
  disabled, and wall-clock, heap and output ceilings enforced by the parent. Only
  an operator promotion makes a package runnable, and checksum drift after
  promotion quarantines it.
- **Seven hardened modules restored**: `identity`, `skillSandbox`, `peerGuard`,
  `skillRegistry`, `taskStore`, `scraperService`, `router`.
- **`workspaceBoundary.ts` restored** — traversal, symlink escape and
  secret-bearing files are refused again.
- **`approvalGate.ts` restored and widened** to RC2's six-type job union, keeping
  the boundary resolution and contract binding. `system_patch` always requires
  operator approval; `model_benchmark` is treated as read-only.
- **Sales orchestrator** no longer starts a timer in its constructor, and its
  counters start at observed zero instead of literals.
- **Gate extended**: `npm run test:frozen` now includes the security suites, so
  this regression cannot pass silently again.

The vulnerable implementation was not left beside the new one as a `.bak` —
resurrecting an archived file is how this happened once already.

## Observed results

Run in this container against this tree, not inferred:

- `tsc --noEmit` over the changed modules and their dependencies: clean
- `npm run test:a2a-hardening` — **47/47 passed**
- `npm run test:rce-closed` — **7/7 passed**, including: hostile code accepted by
  install but refused execution; still unable to reach `process.env` even after
  promotion; benign code runs only once promoted and is checksummed; code edited
  after promotion is quarantined.

## Still NOT VERIFIED

Unchanged from RC2's own honest list, and not claimed here:

- full dependency resolution (`npm ci`) and production build of this tree
- whole-repo `tsc --noEmit` across all 10,849 lines of `server.ts`
- runtime start on port 3000
- physical Windows or Android actuation from this archive
- the multi-iteration autonomous loop

One route-level item is left for you deliberately: `POST /api/a2a/skills/install`
and `POST /api/a2a/tasks/execute` still carry no auth middleware. The execution
path behind them is now safe, but the routes remain open. Putting them behind the
gateway-token handler is a one-line change per route that I did not make blind,
because I could not see which callers depend on them.

---

# Runtime defects found by actually starting it

The four below were found by booting the tree, not by reading it. Each is
observed, and the fix for each was verified by re-running the boot.

| # | Defect | Effect |
|---|---|---|
| 1 | `server.ts:9926` redeclared `intuitionContracts` as an array, shadowing the store from `:193` | `GET/POST /api/autonomy/intuition-contracts` and `.../sign` returned 500 `TypeError: intuitionContracts2.list is not a function`. The contract mechanism the whole autonomy governance rests on was unreachable. |
| 2 | `server.ts:330` `const PORT = 3000` and a literal `"0.0.0.0"` bind | `PORT`/`HOST` were ignored. `jaco.ps1 start -Port 3030` and Render's injected `$PORT` both had no effect. |
| 3 | `skillStore` resolved `SKILLS_DIR` from `process.cwd()` while `SkillRegistry` used the workspace root | `codePath` and `manifestPath` reported two different trees whenever `JACO_WORKSPACE_ROOT` was set. Introduced by the hardening rewrite; my defect, not RC2's. |
| 4 | `memoryStoreV2.ts` called `new Database()` at module scope with no guard | A native SQLite binding was a hard boot requirement for the whole runtime, reached from `server.ts` via `seerService → memoryIntegration`. No prebuild, no compiler, or an Android/Termux target meant the server did not start at all. |

## Observed after the fixes

- `PORT=3210` honoured: `running on http://0.0.0.0:3210` (previously bound 3000 regardless)
- `GET /api/autonomy/intuition-contracts` → `200 {"success":true,"contracts":[]}` (previously 500)
- **Boot with `better-sqlite3` deliberately removed**: process lives, warns
  `[MemoryStore] SQLite unavailable — long-term memory is disabled for this run.`
  and `/healthz`, `/api/desktop/hands-off/status`, `/api/autonomy/intuition-contracts`
  all answer 200.
- `tsc --noEmit` over the changed modules: clean
- `test:a2a-hardening` 47/47, `test:rce-closed` 7/7 — unchanged by these fixes

Defect 1 was fixed independently on the Termux host before this patch landed;
`fix-rc2.py` detects that and skips it.
