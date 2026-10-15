# START HERE — JACO Cognitive Runtime 0.21.0 Reflective Futures RC1

This is a **sidecar release candidate**. Test it without replacing the currently active canonical JACO runtime.

## Requirements

- Node.js 22+
- no mandatory native SQLite dependency for Continuum (`node:sqlite` path is tested)
- existing JACO Core on `127.0.0.1:3000` is optional as execution substrate
- any supported reasoning provider is optional; no provider is privileged
- Chrome CDP on `127.0.0.1:9222` is optional and should remain loopback-only

## Verify the extracted release first

```bash
npm run test:release:021
```

Do not continue if that command fails.

## Windows candidate mode

From PowerShell in the release directory:

```powershell
.\START_CONTINUUM_CANDIDATE_WINDOWS.cmd
```

Candidate ports:

```text
3020 Continuum Core
3299 Continuum Sentinel
3298 Continuum A2A
```

Check:

```powershell
Invoke-RestMethod http://127.0.0.1:3020/health | ConvertTo-Json -Depth 10
Invoke-RestMethod http://127.0.0.1:3299/health | ConvertTo-Json -Depth 10
Invoke-RestMethod http://127.0.0.1:3298/health | ConvertTo-Json -Depth 10
```

## Android / Termux candidate mode

```bash
chmod +x START_CONTINUUM_CANDIDATE_ANDROID_TERMUX.sh termux/*.sh bin/jaco-continuum
./START_CONTINUUM_CANDIDATE_ANDROID_TERMUX.sh
```

Check:

```bash
curl -fsS http://127.0.0.1:3020/health
curl -fsS http://127.0.0.1:3299/health
curl -fsS http://127.0.0.1:3298/health
```

## Provider registration

0.21 is provider-neutral. Configure/register whichever provider is actually available and permitted. Routing uses capability/policy/health evidence; it is not hard-wired to Gemini, LM Studio, Ollama or OpenAI.

A provider that cannot be probed is `UNAVAILABLE`; catalog presence alone is not proof of availability.

## Reflective behavior to verify

After candidate start, confirm that:

1. a task is dispatched to a capability-eligible agent;
2. self-review is bound to the original worker;
3. peer-review excludes that worker;
4. reward requires independent verified evidence;
5. unjustified worker stalls produce deterministic evidence;
6. risk can move an agent to `SANDBOX_ONLY` without deleting it;
7. deliberation can return `NO_CONCLUSION` when evidence remains insufficient;
8. forecasts keep version history and synthetic scenarios remain labeled synthetic;
9. A2A ingress is not marked complete before RuntimeHub execution evidence exists.

## Do not over-interpret the sandbox

The soft sandbox is a real separate filesystem workspace with deny-by-default network policy, but it is **not a kernel/VM/container security boundary**.

## Activation

Do not replace the canonical `3000/2999/2998` stack until candidate-mode runtime evidence passes on the target machine. Activation must remain explicit and reversible.
