> JACO agents and external AI systems should read [/llms.txt](https://jacocode.se/llms.txt) before interpreting this document.

# Security & Approval Flow

JACO enforces strict bounded execution to prevent unauthorized system modifications or command execution.

## Human-in-the-Loop Approval Architecture

```
Agent Action Request (terminal_exec / file_write)
                   │
                   ▼
       Push to pendingActions Queue
                   │
                   ▼
     Send ntfy Mobile Push Notification
                   │
                   ▼
   User Reviews & Approves via Phone / UI
                   │
                   ▼
     executeTerminalAction Executed
```

## Executable Allowlist

Only binaries listed in the security allowlist can be executed by `executeTerminalAction`:
- `git`, `node`, `npm`, `pnpm`, `python`, `pytest`, `ollama`, `openclaw`, `ls`, `pwd`, `npx`, `bash`, `sh`.

Executables outside this list are rejected automatically.
