# Known Limitations — 0.20.0 Continuum RC1

- Target-device Android/Termux and Windows runtime proof is required after installation. Build-container success is not target production certification.
- Android Chrome CDP is not considered connected until `127.0.0.1:9222` returns a real DevTools target on the target phone.
- A2A inbound tasks are queued but are not autonomously executed unless an eligible agent/runtime worker with the required capability claims them.
- No marketplace revenue is claimed until external demand, transaction and settlement evidence exists.
- The OpenAI provider is optional and cloud-disabled by default. Cost correctness depends on caller-supplied/observed usage settlement; it never assumes a price silently.
- JSONL is intentionally used for Continuum control state to avoid a native SQLite startup dependency. It is a single-node control-plane store, not a distributed database.

- The inherited React/Vite/Express UI bundle was not rebuilt in this build container because npm dependency installation timed out and left no complete dev-dependency tree. Continuum standalone runtime verification is independent of that bundle; target bootstrap must rerun `npm ci`, `npm run lint`, and `npm run build` before claiming the integrated UI build.
- Canonical promotion is intentionally operator-gated and is not part of the build-container certification. RC1 is supported as a sidecar candidate first.
