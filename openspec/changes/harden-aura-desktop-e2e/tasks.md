# Execution checklist (check off only with observed evidence)

- [x] Trace actual mission schema, screenshot paths, Win32 input guard, receiver and GUI.
- [ ] Fix shared screenshot path and executor metadata provenance; add regression tests.
- [ ] Add native Windows session/desktop guard for capture and input, preserving original bridge and receipt.
- [ ] Ensure interactive takeover is fail-closed and does not falsely imply exclusive control.
- [ ] Run exact-head tests: Node, TypeScript, production GUI bundle, Windows PowerShell parser and Win32 self-test.
- [ ] Conduct independent adversarial review of security, recovery, uncertain mutation and stale observations.
- [ ] Run connected actual Windows Hyper-V + Chrome Remote Desktop + Notepad edit/readback + cursor/focus takeover acceptance.
- [ ] Merge only with green required checks and documented evidence; physical acceptance must remain explicitly UNVERIFIED until observed.
