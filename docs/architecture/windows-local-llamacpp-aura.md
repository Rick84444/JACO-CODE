# Connect a local Windows GGUF model to Aura (without another JACO runtime)

This procedure reuses the **existing Aura Runtime**, the connected model registry, Continuum, the operator's model selection and all existing computer/browser/terminal tools. A model server supplies inference; it does **not** grant filesystem, mouse, keyboard or shell authority on its own.

## Requirements

- A Windows llama.cpp-compatible `llama-server.exe` that supports this model's quantization, CUDA and its chat template.
- An already downloaded GGUF. For the PrismML 9B PQ2_0 experiment, the operator's default test paths are `%LOCALAPPDATA%\Bonsai9B-Test\bin\...\llama-server.exe` and `%LOCALAPPDATA%\Bonsai9B-Test\models\Ternary-Bonsai-2-9B-PQ2_0.gguf`.
- A usable 8081 loopback port, or another explicitly selected port. Keep the tested Ollama server on port 11434 unaffected.
- No separate Aura, no new tool registry, no automatic download and no change to policy approvals.

## Start inference (independent of JACO)

From a Windows PowerShell 5.1 terminal in the JACO checkout:

```powershell
& .\windows\product\Start-JACO-LocalModel.ps1
```

For another local model/server use `-ServerExe 'C:\...\llama-server.exe' -ModelFile 'C:\...\model.gguf' -Alias 'my-local-model' -Port 8081`. The launcher validates model/binary paths, refuses occupied ports and starts the server bound to `127.0.0.1`. It does not start JACO, stop Ollama, modify `.env` or run in the background.

Check the actual server response in a second terminal:

```powershell
(Invoke-RestMethod 'http://127.0.0.1:8081/v1/models' -TimeoutSec 10).data | Select-Object id
```

The returned ID must be `bonsai-9b` when `--alias` is supported. A model listing is **not** evidence that inference, tool calls or GPU offloading work.

## Connect the existing Aura Runtime

**Option A (before starting JACO):** In the *existing* runtime configuration environment, set:

```dotenv
JACO_LLAMACPP_URL=http://127.0.0.1:8081/v1
JACO_LLAMACPP_MODEL_ALIAS=bonsai-9b
```

The server-side connected registry and Continuum now use that same alias. Retain any GGUF file path in `JACO_LLAMACPP_MODEL` only for the existing model supervisor if used; it must not override the server's alias. Restarting the canonical JACO runtime is required for environment changes to take effect. Do not start a second runtime while the original holds the ledger lock.

**Option B (while JACO is running):** Use **Aura → Connections → Models / Manage providers** to register/choose the existing OpenAI-compatible server at `http://127.0.0.1:8081/v1` and the exact model ID returned above. This updates the connected Aura model selection; it does **not** retroactively change a running Continuum process's environment. For cross-subsystem consistency prefer Option A when restarting normally is safe.

JACO's normal tool controls, CDP attachment, shell MCP server, mission graph and evidence/approval requirements stay authoritative. Do not infer machine access from successful model registration.

## Validate a native tool-call response

Use a **harmless declared function**, not an actual shell/browser command:

```powershell
$body = @{
  model = 'bonsai-9b'
  stream = $false
  messages = @(@{ role='user'; content='To get the time, call get_time. Do not guess.' })
  tools = @(@{ type='function'; function=@{
    name='get_time'; description='Return local time'
    parameters=@{type='object'; properties=@{}; additionalProperties=$false}
  }})
  tool_choice = 'required'
  max_tokens = 128
} | ConvertTo-Json -Depth 10
$r = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/v1/chat/completions' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 180
$r.choices[0].message.tool_calls | Format-List
```

If `tool_calls` is missing, malformed, or the server rejects the request, native tools are **not verified**. Use the existing structured planner path where supported, and keep JACO's existing validation and approval boundaries.

A meaningful local model comparison requires equal context, prompt, output budget and repeated measurements. CUDA/GPU-offload is confirmed from server logs and hardware telemetry, not from an HTTP 200 status.

## Limitations

This integration is source-level and CI-verifiable. Actual Windows launch, PrismML compatibility, 6 GB GPU fit, inference speed, tool calls and hands-on computer control still require real operator-host evidence. No claim of end-to-end autonomy is made by this setup.
