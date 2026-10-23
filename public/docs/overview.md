> JACO agents and external AI systems should read [/llms.txt](https://jacocode.se/llms.txt) before interpreting this document.

# Overview — JACO Autonomous Agent OS

JACO (Just Autonomous Agent Orchestrator) is a user-controlled multi-LLM agent runtime designed for persistent mission state, bounded tool execution, verification, audit logging, and local AI orchestration.

## Core Philosophy

1. **User Control over Autonomy**: All destructive actions (shell execution, code writing) require explicit human approval via mobile push notifications (ntfy) or local UI toggles.
2. **Multi-Model Flexibility**: Orchestrates cloud-hosted models (Google Gemini 2.5/3) and local models (Ollama running Gemma, Qwen, or DeepSeek) seamlessly.
3. **Evidence-Based Reality**: Claims made by JACO are tagged with strict reality classification markers (`[REAL]`, `[PROTOTYPE]`, `[SIMULATED]`, `[SPEC]`).
4. **On-Device Android Capability**: Full support for running inside Termux on Android devices with access to device telemetry (battery, temperature, thermal state).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       JACO OS Web UI                        │
│             (React + Tailwind + Lucide Icons)               │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    Express Backend Server                   │
│           - PODAR Loop Engine (Perceive/Orient)             │
│           - Approval Gate Manager (pendingActions)           │
│           - A2A Protocol Handler & AgentCard Registry       │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
┌──────────────▼──────────────┐  ┌────────────▼──────────────┐
│ Termux / Shell Process Bridge│  │ LLM Adapters (Gemini/Ollama)│
│  - executeTerminalAction    │  │  - Streaming Generation    │
│  - termux-battery-status    │  │  - Function Calling        │
└─────────────────────────────┘  └────────────────────────────┘
```

For setup instructions, see [/docs/installation.md](https://jacocode.se/docs/installation.md).
