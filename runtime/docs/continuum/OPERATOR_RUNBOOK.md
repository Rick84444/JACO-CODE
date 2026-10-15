# Operator Runbook

## Android / Termux: zero-downtime candidate
Run:

```bash
./START_CONTINUUM_CANDIDATE_ANDROID_TERMUX.sh
```

This starts the candidate on Core `3020`, Sentinel `3299`, A2A `3298`. The currently running canonical `3000/2999/2998` is only observed and recorded; it is not stopped or reconfigured.

Inspect:

```bash
curl -s http://127.0.0.1:3020/api/runtime/identity
curl -s http://127.0.0.1:3020/api/continuum/status
curl -s http://127.0.0.1:3298/health
```

Stop candidate:

```bash
./termux/stop-continuum-candidate.sh
```

Promote only after candidate proof exists:

```bash
./termux/activate-continuum.sh
```

Activation backs up `~/.config/jaco/runtime.env`, switches `JACO_ROOT`, restarts the existing runit services and verifies 3000/2999/2998. On failure it restores the previous env and restarts the previous runtime.

## Windows
Run `START_CONTINUUM_CANDIDATE_WINDOWS.cmd`. It uses the same isolated candidate ports and writes `.jaco/candidate/candidate-proof.json`. It does not stop a canonical process on port 3000.

## Operator control
With the candidate core running:

```bash
bin/jaco-continuum status http://127.0.0.1:3020
bin/jaco-continuum pause http://127.0.0.1:3020
bin/jaco-continuum resume http://127.0.0.1:3020
bin/jaco-continuum emergency-stop http://127.0.0.1:3020
```

If `GATEWAY_TOKEN` is configured, export it before using the CLI.

## Cloud spend
Cloud is disabled by default. Enable it only through an explicit policy update and a configured API key. Never place API keys in mission objects, agent messages or evidence.
