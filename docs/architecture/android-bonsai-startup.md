# Android Debian: local Bonsai Core recovery

The observed device failure was a zero exit from `runtime/dist/server.cjs` followed by readiness timeout. The direct TypeScript Core reached READY, but the browser did not render and the process later crashed. The exact cause of the old local bundle exit and the device crash has not been captured. The source-static profile is an explicit lower-overhead recovery path, not an assertion that the bundle or device crash is fixed.

In the existing checkout, after stopping previous JACO startup/service processes, run:

```sh
nvm use 24
curl -fsS http://127.0.0.1:9380/v1/models
npm --prefix runtime run build:client
node scripts/start-local-bonsai.mjs
```

The launcher requires the existing `bonsai-4b` alias at the loopback llama.cpp endpoint, reads the reported context window, verifies nonempty completion text, and atomically saves the operator selection via the existing Aura shared planner choice. No model is downloaded or loaded a second time. It starts the canonical Aura stack with source TypeScript and static dist UI. It selects compact structured planning, disables automatic MCP startup (existing tools remain available on demand), and disables optional CDP/tunnel helpers for this diagnostic profile only. It does not modify .env or disable authorization/approvals. The operator selection is persisted intentionally.

Do not start on top of a previous stack launched with different environment settings. The startup lock refuses live launchers. Old invalid locks still require operator inspection; new lock publication is atomic. Do not delete mission state or stop unrelated Node/llama.cpp processes. No global process kill is used.

`GUI HTTP_READY` proves HTML and the actual JavaScript entry are served, not that React rendered on Android. Open the printed JACO GUI origin in Chrome. Current model proof covers text only, not schema planning, tool receipts, memory pressure, or background behavior.

`node agents/lib/local-stack.mjs --status` uses resolved endpoints; set `JACO_START_MODE=source-static` to include the static UI check. The fresh Core smoke test in CI builds and tests production and source-static independently. A physical phone restart and a bounded real mission remain required.
