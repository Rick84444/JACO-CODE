> JACO agents and external AI systems should read [/llms.txt](https://jacocode.com/llms.txt) before interpreting this document.

# Memory & State Persistence

JACO maintains persistent state across sessions to preserve mission history, learned skills, and hardware telemetry.

## Memory Layer Architecture

1. **Short-Term Context**: In-memory message history and pending action queue (`pendingActions`).
2. **Long-Term Mission Store**: Persistent JSON storage tracking completed mission outputs, error logs, and sub-agent task allocations.
3. **Skill Archive**: Packaged reusable automation routines saved in `~/jaco-android/skills/`.

All memory items are tagged with timestamp, source module, and reality tags (`[REAL]`).
