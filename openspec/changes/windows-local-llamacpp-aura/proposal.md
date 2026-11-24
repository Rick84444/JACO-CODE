# Windows local llama.cpp integration into canonical Aura

## Problem

An operator can run a GGUF model (including ternary Bonsai) using an external Windows llama-server on port 8081, but the model alias is not consistently forwarded to both connected Aura and Continuum. Using a GGUF file basename in lieu of the actual server model ID can break inference. The local server also needs a repeatable, safe Windows launch path.

## Scope

- Reuse the existing Aura/Continuum provider registries, tool/mission execution, approval policies and planner protocols. No second Aura or tool executor.
- Support an explicit, stable llama-server model alias in Continuum, matching connected Aura's existing JACO_LLAMACPP_MODEL_ALIAS precedence.
- Provide an opt-in Windows launcher for a user-installed, separate llama-server and GGUF, without downloads, driver changes, runtime autostart, port stealing or new permissions.
- Provide regression checks and setup documentation. No assertion of real RTX model quality or tool-call compatibility until observed on the target host.

## Acceptance and falsifier

A configured `JACO_LLAMACPP_MODEL_ALIAS=bonsai-9b` is the same model ID in both registries, even when JACO_LLAMACPP_MODEL is a filesystem path. `JACO_LLAMACPP_URL=http://127.0.0.1:8081/v1` stays loopback. An unavailable endpoint and occupied port fail visibly without starting a duplicate process. A native tool-call probe must be observed before native tool execution is claimed; existing structured planner fallback must not broaden permissions.

## Non-goals

Installing PrismML dependencies, auto-downloading models, modifying Windows drivers, remote device access, automatic selection of an unverified model, or bypassing existing mission policies.
