# Local llama.cpp provider — additive requirements

## ADDED Requirements

### One canonical Aura and Continuum model identity
When the operator configures a local llama.cpp server with `JACO_LLAMACPP_URL` and an explicit `JACO_LLAMACPP_MODEL_ALIAS`, both Aura connected-provider selection and Continuum MUST use that alias rather than a GGUF filename. If no alias is set, legacy model-path behavior remains available. The model is an inference provider only, not another agent/runtime.

#### Scenario: Windows 8081 Bonsai model
- Given `JACO_LLAMACPP_MODEL=C:\\models\\Bonsai-9B.gguf`, `JACO_LLAMACPP_MODEL_ALIAS=bonsai-9b`, and `JACO_LLAMACPP_URL=http://127.0.0.1:8081/v1`
- When the canonical registries are initialized
- Then the provider uses `bonsai-9b` and `http://127.0.0.1:8081/v1` in both registries.

### Safe Windows local model launch
A supplied model and llama-server executable MUST be checked before launch. The launcher MUST fail when its port is already occupied, MUST bind loopback, and MUST NOT alter or restart the canonical Aura runtime or its permissions.

#### Scenario: occupied port
- Given a listener already owns port 8081
- When the operator attempts to start another local model
- Then the launcher fails with `LOCAL_MODEL_PORT_OCCUPIED` without terminating the listener.

### Evidence before computer-control claims
A valid `/v1/models` response MUST NOT be treated as proof of native tool calls or computer-control success. Native tool calls and hardware support remain subject to actual probes and the canonical tool/mission verification policies.
