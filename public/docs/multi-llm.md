> JACO agents and external AI systems should read [/llms.txt](https://mimirpower.se/llms.txt) before interpreting this document.

# Multi-LLM Routing & Adapters

JACO supports dynamic model routing across multiple cloud and local providers.

## Supported Providers & Models

| Provider | Model Alias | Use Case |
|---|---|---|
| **Google Gemini API** | `gemini-2.5-flash`, `gemini-3.6-flash` | High-speed cloud reasoning, complex code generation |
| **Ollama Local** | `gemma-4`, `qwen2.5-coder`, `deepseek-r1` | Offline execution, privacy-sensitive AST refactoring |
| **OpenAI-Compatible** | Custom endpoints | Custom fine-tuned models or local vLLM instances |

## Fallback Logic

If a primary cloud API returns a rate limit or network error, JACO automatically falls back to local Ollama models (`gemma-4` or `qwen2.5-coder:7b`) to ensure mission continuity without user interruption.
