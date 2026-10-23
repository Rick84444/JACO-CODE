> JACO agents and external AI systems should read [/llms.txt](https://jacocode.com/llms.txt) before interpreting this document.

# Runtime Engine — PODAR Execution Loop

The JACO runtime operates using a continuous **Perceive-Orient-Decide-Act-Reflect (PODAR)** execution loop.

## 1. Perceive
- Reads system telemetry (CPU usage, memory consumption, Termux battery level, thermal state).
- Monitors incoming user requests and pending A2A RPC messages.

## 2. Orient
- Evaluates active mission goals against current workspace state.
- Identifies missing skills or unhandled errors in previous executions.

## 3. Decide
- Determines whether to spawn a sub-agent, execute a terminal process, write a code patch, or query OpenClaw.

## 4. Act
- Formulates a `PendingAction` object (`terminal_exec` or `file_write`).
- Sends a push notification to the user's mobile device via ntfy.
- Upon approval, invokes `executeTerminalAction` using `child_process.spawn`.

## 5. Reflect
- Captures command stdout/stderr output.
- Logs results into the persistent memory store with reality classification tags (`[REAL]`).
