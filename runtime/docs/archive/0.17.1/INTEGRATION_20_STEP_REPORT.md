# JACO 0.17.1 Antigravity + SEER + Android/Local Bridge — 20-step integration report

Release candidate: `0.17.1-antigravity-seer-bridge-rc1`

## 1. Freeze both source trees
**Decision:** Keep the complete Antigravity GUI/API surface as the presentation/runtime shell and use 0.17.1 hardening principles for SEER, edge security, queue recovery and local/Android transport.
**Advantage:** Minimal GUI/API regression surface.
**Disadvantage:** The Antigravity server remains large and needs later modular decomposition.
**Change:** Sources copied into a new immutable RC tree; originals untouched.
**Gate:** Source trees inspected before modification.

## 2. Map GUI/runtime responsibilities
**Decision:** GUI owns display and control; runtime owns evidence, execution and state.
**Advantage:** Removes duplicated “fake runtime in UI”.
**Disadvantage:** Some older components still contain visual demo-oriented labels that are not execution paths.
**Change:** Runtime-critical state is hydrated from API rather than trusted from static initial data.

## 3. API contract inventory
**Decision:** Do not replace Antigravity server with the smaller 0.17.1 server wholesale.
**Advantage:** Keeps the >200 API contracts expected by the GUI.
**Disadvantage:** Security must be integrated into this larger server rather than inherited automatically.
**Gate:** Client/server API call inventory generated.

## 4. Preserve SEER as operational control plane
**Decision:** Keep Antigravity's existing SEER API surface but remove fabricated defaults and add evidence-state reporting.
**Advantage:** Existing GUI routes remain compatible.
**Disadvantage:** This is not a byte-for-byte transplant of the old v12 controller; behavior is converged at the contract/evidence layer.
**Change:** `GOAL-UNCONFIGURED`, zero evidence defaults, provider/evidence state in `/api/seer/status`.

## 5. Truthful SEER telemetry
**Decision:** Missing CPU/memory/goal evidence must remain unavailable.
**Advantage:** SEER cannot accelerate based on invented low-load defaults.
**Disadvantage:** First cycle may be conservative until telemetry is observed.
**Change:** Rule-based fallback uses one worker when telemetry is unavailable and records the reason.

## 6. Truthful SEER GUI status
**Decision:** Remove static `[REAL]`/“protocol engaged” claims.
**Advantage:** UI status now follows backend evidence.
**Disadvantage:** UI looks less “alive” before a real cycle completes, which is intentional.
**Change:** `UNVERIFIED`, `DEGRADED`, `OBSERVED` badge and provider readout.

## 7. Remove mock startup device/model state
**Decision:** Boot with empty model/device/history arrays and unavailable telemetry.
**Advantage:** No fake Pixel, model, NPU or workstation state is shown as observed.
**Disadvantage:** Panels depend on API hydration to populate.
**Change:** Replaced `mockData.ts` runtime values with evidence-empty startup values.

## 8. Android/local bridge architecture
**Decision:** One bridge service supports direct Termux execution or a relay configured by `JACO_ANDROID_BRIDGE_URL`.
**Advantage:** Same API works when JACO runs on Android or on a local workstation controlling Android.
**Disadvantage:** Remote device reachability still depends on LAN/tunnel routing outside the process.
**Change:** Added `src/server/bridge/androidLocalBridge.ts`.

## 9. Cryptographic pairing
**Decision:** Pairing must validate an expiring one-time challenge instead of accepting any code.
**Advantage:** Remote execution cannot be unlocked with an arbitrary GUI value.
**Disadvantage:** Remote clients need to preserve the issued token.
**Change:** Random challenge ID + 6-digit code hash + timing-safe comparison + 24h bearer token.

## 10. Remote-vs-loopback authorization
**Decision:** Loopback GUI calls stay frictionless; non-loopback Termux execution requires a valid pairing token.
**Advantage:** Local UX remains simple while LAN exposure is gated.
**Disadvantage:** A reverse proxy must preserve the client address correctly or bind JACO to loopback/tunnel deliberately.
**Change:** `/api/termux/execute` checks socket address and pairing token for remote callers.

## 11. Command execution boundary
**Decision:** No arbitrary shell string execution through the bridge.
**Advantage:** Blocks shell operators and common injection paths.
**Disadvantage:** New executables must be explicitly added to the allowlist.
**Change:** `spawn(..., shell:false)`, executable allowlist, 15s timeout.

## 12. Android proxy SSRF boundary
**Decision:** Proxy only explicitly known local service ports.
**Advantage:** `/api/android/proxy/:port` can no longer probe arbitrary localhost ports.
**Disadvantage:** New plugins need an allowlist update.
**Change:** Fixed allowlist for Ollama, Termux bridge, addon, WebADB, LM Studio, LiteRT and known local runtimes.

## 13. Remove fake Android hardware success
**Decision:** Container fallback cannot claim torch hardware changed.
**Advantage:** Hardware evidence is trustworthy.
**Disadvantage:** Desktop development returns `UNAVAILABLE` rather than a pleasant simulated success.
**Change:** Torch relay failure => `success:false`, truth `UNAVAILABLE`.

## 14. Queue recovery hardening
**Decision:** Reuse 0.17.1 stale-job reaper against Antigravity's compatible queue contract.
**Advantage:** Claimed/running work cannot disappear forever after worker/process failure.
**Disadvantage:** Very long jobs need a lease value appropriate to their workload.
**Change:** Job reaper starts with runtime and stops on shutdown.

## 15. HTTP edge hardening
**Decision:** Add request IDs, security headers, JSON size/content checks, rate limiting, no `x-powered-by`, no trusted proxy headers by default.
**Advantage:** Better LAN/tunnel exposure posture with no new runtime dependency.
**Disadvantage:** CSP can restrict intentionally embedded external content; external strategist interaction should therefore use adapters/open-external flows rather than assuming cross-origin iframe access.

## 16. Replace economic kernel stubs
**Decision:** Persistent local data and cryptographic integrity instead of mock hashes/tokens/products.
**Advantage:** Ledger, products and entitlements now have real local semantics.
**Disadvantage:** Production commerce still requires real Stripe configuration and business policy.
**Change:** Hash-chained JSONL ledger, persistent product registry, HMAC entitlement tokens, real Stripe Checkout invocation when configured.

## 17. Remove stub regeneration path
**Decision:** Delete `create_economic_stubs.cjs`.
**Advantage:** A future script cannot silently restore the removed mock implementation.
**Disadvantage:** None; the script was incompatible with release truthfulness.

## 18. Fail closed for unsupported operations
**Decision:** Unknown Forge journey tools, absent ISO toolchain and absent Cloudflare binary cannot fabricate success.
**Advantage:** Evidence and release status mean what they say.
**Disadvantage:** Some previously decorative buttons now surface unavailable/error until their external toolchain exists.
**Change:** Forge unsupported step => FAILED; ISO build => 501; Cloudflare uses a real spawned `cloudflared` quick tunnel and only publishes an observed URL.

## 19. Remove simulated client telemetry/streaming
**Decision:** Client heartbeat uses `/api/telemetry/hardware`; failed agent stream yields `UNAVAILABLE`.
**Advantage:** No random temperature/latency or synthetic “visionary tokens”.
**Disadvantage:** Offline UI is quiet instead of animated.

## 20. Verification and release gate
**Executed gates:**
- Truthful-runtime static contract verifier: **15/15 PASS**.
- TypeScript/TSX syntax transpilation: **178 files, 0 syntax diagnostics**.
- Suspicious core-server stub scan: **no matches** for the known fake hash/token/cloudflare/ISO/forge patterns after patching.
- Full dependency typecheck/build: **NOT VERIFIED in this environment** because `npm ci` did not finish before the container transport timeout; `node_modules/.bin/tsc` and Vite/esbuild were therefore unavailable.

**Release decision:** RC only. Do not promote to final until `npm ci`, `npm run lint`, `npm run build`, runtime startup, `/api/seer/status`, SEER cycle, Android pairing/relay and GUI smoke tests pass on the target Termux/Windows environment.
