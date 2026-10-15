# JACO repository instructions for coding agents

This repository uses **JACO Workplace** as its shared operational state across VS Code agents, Codex sandboxes, ChatGPT sessions, JACO runtime agents and other AI participants.

Before making shared repository changes:

1. Read `/JACO_AGENT_BOOTSTRAP.md`.
2. Build a truthful `jaco.agent-card/v1` card for the current session.
3. Register with JACO Workplace at `JACO_WORKPLACE_URL` (default `http://127.0.0.1:2995`).
4. Sync and ACK current Workplace state.
5. Check active `DECISION`, `MISSION`, `CLAIM`, `HANDOFF`, `RESULT` and `ERROR` events.
6. Acquire a claim before mutating a shared file when practical.
7. Publish findings, progress, results and handoffs back to Workplace.

If Workplace is unavailable, explicitly mark the session `DEGRADED_UNSYNCED`; do not assume this chat/editor context is authoritative.

Never invent capabilities, tool access, completed executions, test results, commits, messages from other agents, or acknowledgements.

The durable implementation is in `gateway/src/workplace/` and the Agent Card schema is `gateway/src/workplace/agent-card.schema.json`.
