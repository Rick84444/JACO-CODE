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
