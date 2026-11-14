# Tasks
- [x] Enumerate every consumer of each default port: configuration() env, `Start-JACO.ps1` identity fallback, `emergency-stop.ps1` port list (the other hits are developer setup scripts).
- [x] Add ownership classification and port allocation to the activation path (`resolveServicePorts` in `agents/lib/local-stack.mjs`).
- [x] Persist and propagate resolved ports (`resolved-ports.json`, `portEnvironment`).
- [x] Regression tests with injected and real foreign listeners (`tests/nova/port-resolution.test.mjs`, `startup-safety.test.mjs`).
- [x] Silent sign-in autostart in the installer, no assistant required (`tests/nova/windows-selfstart.test.mjs`).
- [ ] Observe CI on the exact SHA.
- [ ] Prove on a Windows installed run with port 3000 occupied.
