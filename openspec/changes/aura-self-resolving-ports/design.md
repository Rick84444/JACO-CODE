# Design: port resolution in the existing activation path

## Decisions
1. Resolution lives in `local-stack.mjs` `configuration()`/`activate()`; no second launcher.
2. Allocation is deterministic: scan upward from the default within a bounded range, skip ports claimed by another JACO service.
3. The chosen ports are written to the local data root state, not source or `.env.example`, and reused on restart.
4. A foreign process is never terminated. Ownership is decided by the existing `ownsListener` and `processBirth` evidence.
5. Unknown ownership fails closed to "choose another port", not to "kill".

## Risks
Hard-coded URLs in clients, tests and Windows scripts must read the resolved ports. Missed consumers cause split-brain; a test must enumerate consumers of each default port.
