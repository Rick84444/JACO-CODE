## 1. Baseline and ownership
- [ ] Map every startup entry point, readiness probe, dependency and existing spec; reproduce failures on exact SHA.
- [ ] Record baseline and security boundaries; reconcile existing spec deltas.

## 2. Implementation
- [ ] Integrate dependency preflight and setup through canonical start path with lock and bounded repair.
- [ ] Implement required/optional capability classification after tracing consumers.
- [ ] Verify provider identity, startup evidence and safe token handling; preserve policy.
- [ ] Implement bounded recovery and restart continuity using existing state.
- [ ] Ensure Android and VS Code observe same runtime identity and status.

## 3. Verification
- [ ] Add negative controls and regression tests for missing dependencies, invalid token, foreign listeners, unavailable optional service, provider failure and false READY.
- [ ] Run syntax/type checks, focused tests, builds and relevant CI on exact SHA.
- [ ] Run ten real Windows cold starts and injected recovery; verify mission continuity and client identity on target hosts.
- [ ] Record observed results, durations, limitations and independent review; merge only on applicable green CI and acceptance evidence.
- [ ] Archive after merge and synchronize canonical specs.
