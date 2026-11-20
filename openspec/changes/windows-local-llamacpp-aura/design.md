# Design

## Current owner

`runtime/src/server/connected/providerRegistry.mjs` already reads `JACO_LLAMACPP_MODEL_ALIAS`, `JACO_LLAMACPP_MODEL_ID`, and `JACO_LLAMACPP_MODEL`. `runtime/src/server/continuum/providerRegistry.mjs` currently reads only the GGUF path and derives its basename. The latter is fixed to use the same precedence, without a new registry or special-casing model families.

The Windows launch helper calls the existing llama-server binary with `--alias`, bind `127.0.0.1`, `--jinja`, a bounded context, and configured GPU layers. It checks paths and port ownership; it does not write JACO's settings or start the canonical runtime.

Aura's existing Connections UI can register the loopback base URL and server-advertised model. The operator can also configure `JACO_LLAMACPP_URL` and `JACO_LLAMACPP_MODEL_ALIAS` before starting JACO; Continuum reads the same variables. No token or permission setting changes.

## Risks

- The installed llama.cpp fork might not support `--alias` or `--jinja`; the process must fail rather than claim readiness.
- The ternary GGUF might have a broken or unsupported chat template; model listings and plain text are not evidence of tool calls.
- Context and GPU offload depend on Windows driver, available VRAM and exact binary; CI cannot verify operator hardware.
- If JACO is already running, changing its environment in another PowerShell window will not reconfigure it. Its connected-provider UI can configure the endpoint while online.

## Verification

Deterministic Node regressions assert alias precedence on connected Aura and Continuum. Windows Actions parses the launcher in Windows PowerShell 5.1; a model/hardware test remains a separately reported operator-host verification.
