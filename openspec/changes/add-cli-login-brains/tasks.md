# Tasks
- [x] cliBrains.mjs with stub-able spawn; unit tests incl. env scrubbing and stdin prompt (tests/nova/cli-brains.test.mjs, 9/9 pass)
- [x] ProviderRegistry: kind `cli-login` in probe/scan/chat; persists across restart (covered by the registry test)
- [ ] server.ts routes (list, login) behind requireLocalUi: written and typechecked, NOT exercised by any test or running server
- [x] BrainLogin.tsx in ProviderConnect; `tsc --noEmit` clean; rendered in Chromium with mocked routes (layout only)
- [x] Aura snapshot lists `subscriptionBrains` (source change, typechecked; not observed at runtime)
- [x] Regression: existing provider tests green (41/41 after installing root dependencies)
- [ ] Operator-side: real `claude auth login` and one completion on the operator's computer (UNOBSERVED)
- [ ] Operator-side: codex and gemini commands (UNOBSERVED); Windows quoting of the empty `--tools` argument (UNOBSERVED)

## Extension on Claude revision 584fe3c
- [ ] New CLI safety and subscription-status regression tests added; rerun original suite and typecheck.
- [ ] SIWC authorization, ID-token verification, official model discovery and terminal SSE transport implemented; signed-fixture tests added, not run here.
- [ ] Opt-in local SIWC callback/session, GUI and explicit model request wired; live verification outstanding.
- [ ] Integrate secure persistent multi-account credential vault, refresh/revocation, explicit autonomous/background consent, and provider routing with policy/cost accounting.
- [ ] Gemini AI Studio onboarding and current Google CLI entitlement/terms integration, native Windows launcher validation.
- [ ] Full CI, negative route tests, target host evidence and review before merge. No production-ready claim.
Preview starts only on a user-controlled local host with JACO_LOCAL_SIWC=1. Credentials are process-only. No automatic registration or usage. Shell tool policy unchanged. The dev branch is based on Claude's exact commit rather than pushing to the concurrently edited branch.

## Compact provider dialogs and GitHub Actions extension
- [ ] Verify compact provider launcher and single native modal using SSR and controlled Chromium desktop/mobile tests (tests added, execution not observed).
- [ ] Verify API key field lifecycle and provider scoping (browser test added; unverified).
- [ ] Verify read-only GitHub Actions projection and existing source-control integration (negative/positive tests added; no live gh session observed).
- [ ] Observe Subscription Provider Gate results for Linux, Windows, production builds and browser tests on final SHA; retain artifacts and review before merge. No CI result had been returned for 57573781 at inspection time.

## Plugin Center, finance and enterprise release criteria
- [ ] Verify configured MCP catalog and public registry discovery against actual provider endpoints; directory-only entries remain unimplemented.
- [ ] Verify local account-page launcher with operator opt-in, exact endpoint match, revoked permission, current capability, and safe launch on Windows/Linux. Tests added; no target-host execution observed.
- [ ] Verify financial option projection and active mission steering preserve original objective, budget and no financial execution; sandbox is not real revenue.
- [ ] Verify integration management dialogs and create-only configuration, scoped login permission edit, stale observation state and provider-specific logos on desktop/mobile. Controlled Chromium tests added; not yet observed.
- [ ] Verify CI at final revision and review known security, OAuth, financial and provider entitlement limits before release. Local git access failed DNS; CI for revision 76c0dc89 was queued at inspection. No green gate observed.
