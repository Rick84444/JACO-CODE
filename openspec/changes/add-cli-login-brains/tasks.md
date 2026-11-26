# Tasks
- [x] cliBrains.mjs with stub-able spawn; unit tests incl. env scrubbing and stdin prompt (tests/nova/cli-brains.test.mjs, 9/9 pass)
- [x] ProviderRegistry: kind `cli-login` in probe/scan/chat; persists across restart (covered by the registry test)
- [ ] server.ts routes (list, login) behind requireLocalUi: written and typechecked, NOT exercised by any test or running server
- [x] BrainLogin.tsx in ProviderConnect; `tsc --noEmit` clean; rendered in Chromium with mocked routes (layout only)
- [x] Aura snapshot lists `subscriptionBrains` (source change, typechecked; not observed at runtime)
- [x] Regression: existing provider tests green (41/41 after installing root dependencies)
- [ ] Operator-side: real `claude auth login` and one completion on the operator's computer (UNOBSERVED)
- [ ] Operator-side: codex and gemini commands (UNOBSERVED); Windows quoting of the empty `--tools` argument (UNOBSERVED)
