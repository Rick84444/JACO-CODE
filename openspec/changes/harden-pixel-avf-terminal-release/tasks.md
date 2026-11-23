# Tasks and evidence map

- [x] Read AGENTS.md, runtime/AGENTS.md and openspec/project.md.
- [x] Compare latest main, PR #224 and release/Android paths.
- [x] Specify accepted and denied scenarios before implementing changes.
- [ ] Integrate existing Pixel files on current main without discarding new runtime code.
- [ ] Make checked Debian arm64 installation and release selection unambiguous.
- [ ] Add negative and positive launcher/package installer regression tests.
- [ ] Verify source syntax and local narrow tests against the exact change SHA.
- [ ] Verify GitHub CI (Android APK, Lite package, and relevant runtime gates) on exact head.
- [ ] Independent code review, resolution of findings, and merge only if required CI is green.
- [ ] Prove physical Pixel Debian AVF startup, Chrome loopback access, app model inference and reconnect behavior.
- [ ] Prove deployed and authenticated Windows Aura Link with the operator's host.

Unchecked tasks are NOT completed by a source review, mock test or green unrelated CI.

- [ ] Verify exact main source commit through the actual Android installer on ARM64 CI and after publication.
- [ ] Verify same-timestamp platform migration and update after rollback with installer regression tests.
