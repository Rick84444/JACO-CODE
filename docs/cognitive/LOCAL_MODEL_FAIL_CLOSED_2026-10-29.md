# Local-first Continuum: actual inference and fail-closed boundaries

## Goal / reality tags

[REAL] Continuum can already reach Ollama (`/api/generate`) and local OpenAI-compatible llama.cpp/LM Studio (`/chat/completions`). The existing JACO lease and mission systems remain authoritative. A local model is an inference provider, not a separate operator or a tool authority.

[REAL] On-device inference now has an explicit trust boundary:

- `local: true` is accepted only for URL-parsed loopback endpoints (`localhost`, `127.0.0.0/8`, `::1`) with no embedded credentials/query/fragment. A remote/LAN provider cannot silently call itself local and bypass the cloud budget. Legacy untrusted entries are excluded from ordinary candidate routing and refused by the execution path.
- Redirects are refused on on-device requests so a local `/v1` or Ollama endpoint cannot redirect a prompt to the internet.
- `reason({ localOnly: true })` or `JACO_LOCAL_ONLY=1` excludes remote providers entirely. Forced remote selection does not override this. No cloud fallback occurs when local inference fails.
- A response must include nonempty completion text. Ollama additionally requires `done: true`; local inference HTTP 200 without useful completion is not counted as success.
- Ollama's context is bounded by `JACO_OLLAMA_NUM_CTX` (default 4096, accepted 1024–32768). Generation is capped to one-quarter of this budget to reduce OOM/thermal load on phones. These are memory-pressure precautions, not guarantees.

## Diagnose the **actual** model

Authenticated `POST /api/continuum/models/local/probe` (existing Continuum router authentication applies) with body `{ "providerId": "ollama-local", "timeoutMs": 90000 }` sends a real, low-output generation request using only local endpoints. It executes at most one probe at a time and returns:

- `INFERENCE_VERIFIED`: the selected local model completed a text-generation request; **NOT** proof of tool-calling, a complete agent mission or system-wide READY.
- `INFERENCE_FAILED`: no usable local inference. Error code recorded; not silently passed off to cloud.
- `INFERENCE_BUSY`: another explicit inference probe is active.

On-device diagnoses must be run on the actual Android/Termux machine or computer with the model installed. CI tests mock provider HTTP responses to verify protocol and fail-closed behaviour without downloading weights. There is no claim of having successfully run the user's physical model yet.

For a local-only startup, configure `JACO_LOCAL_ONLY=1`, one of `JACO_OLLAMA_MODEL`, `JACO_LLAMACPP_MODEL` (with `JACO_LLAMACPP_URL=http://127.0.0.1:9380/v1`), or `JACO_LMSTUDIO_MODEL` (and its loopback URL). For a model hosted on another computer, use a secure localhost tunnel to reach it; a raw LAN host is deliberately not treated as an on-device endpoint.

## Limits / follow-up acceptance

[UNKNOWN] Whether the particular model on the phone fits in RAM, stays responsive under thermal throttling, produces valid tool calls for Nova, or can maintain mission-level progress after Android sleeps. Test these separately with the real device and fresh runtime receipts. An `INFERENCE_VERIFIED` result is only **level 1** of operational verification. Level 2 needs a bounded mission with one allowed tool and a verified action receipt. Level 3 needs restart, lease fencing and sustained operations.

## Independent research and adversarial review lanes

The hardening analysis used three independent **review perspectives**, not three separately executing LLM agents: (a) Model API contracts, (b) runtime trust/economics, (c) hostile/empty-response and fallback tests. Do not record these as three autonomous research agents in JACO's ledger.

Sources (original technical documentation):
- Ollama API: https://docs.ollama.com/api (stream:false, `done`, model identity, `keep_alive`)
- llama.cpp server: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md (`/health` and `/v1/chat/completions`)
- Android local model integration limitations: https://developer.android.com/studio/gemini/use-a-local-model

## Test and compatibility

`node --test runtime/scripts/continuum/local-inference-hardening.test.mjs` executes 17 isolation tests. They use fake HTTP responses, with no internet request and no cloud spend. The Continuum CI workflow runs them alongside the existing runtime, single-writer and reflective-futures contracts; GitHub merge approval requires an exact-head SHA with green relevant checks.
