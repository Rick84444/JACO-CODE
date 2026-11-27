# Tasks
- [x] Trace provider registry, transport, credential store, UI and tests.
- [ ] Support current Google AI Studio authorization-key discovery and verified Gemini transport; regression-test old and new key shapes.
- [ ] Add guided AI Studio key import using existing local credential store and real validation.
- [ ] Implement official SIWC registration, local OAuth callback and OIDC verification.
- [x] Implement account-bound secure storage, refresh, disconnect and consent controls (fixture tests; real account not yet observed).
- [ ] Integrate Responses API streaming and tool-call protocol into the existing runtime.
- [ ] Add billing-mode and quota/error UI; no unauthorized fallback.
- [ ] Add negative security and regression tests, run type/syntax and relevant CI.
- [ ] Obtain real user-authorized Windows-host ChatGPT/Gemini evidence; verify Android remote UI.
- [ ] Independent review and green CI before merge.

- [ ] Verify official Gemini ACP and Antigravity CLI entitlement, supported delegation interfaces and usage terms; distinguish interactive from unattended use.
- [ ] If supported, extend existing execution registry with local CLI delegation, isolation, cancellation, policy enforcement and structured evidence; test with real accounts.
