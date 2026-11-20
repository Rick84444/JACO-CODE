# Tasks
- [x] Align perception aliases with built-in registration and add regression.
- [x] Bound catalog wait, isolate stale descriptors, deduplicate concurrent refreshes and separate mission-local read/write views; add isolation and cooldown regressions.
- [x] Preserve pre-dispatch versus unknown outcomes; add 409, superseded HTTP sessions, startup/access changes and launch-metadata regressions.
- [x] Align chat and API argument checks; prevent agent discovery when both MCP capabilities are disabled.
- [ ] Run all affected CI gates successfully on the final revision.
- [ ] Verify actual runtime behavior on the target Windows host.

Implementation and regression fixtures are committed. The CI and target-host items remain separate evidence requirements. A non-JSON intermediary 401/403 is intentionally not accepted as proof that a write was never dispatched.
