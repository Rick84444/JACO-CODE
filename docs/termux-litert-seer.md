# Termux: connect LiteRT-LM to Aura and SEER

LiteRT-LM, SEER and the JACO Core backend must run on the same device when using
loopback URLs. A browser on a computer can display the phone's GUI, but a Core
backend running on the computer cannot reach the phone through `127.0.0.1`.

## Select the installed model

Use the ID shown by `litert-lm list`, not the downloaded `.litertlm` filename.
For an installation whose registered ID is `gemma4-e2b`:

```bash
jaco restart --provider litert --model gemma4-e2b
```

These flags are accepted by `activate` and `restart`. They update only the model
settings in the canonical runtime env and project `.env`, keeping the choice
across future activations. Selecting LiteRT or llama.cpp explicitly disables
cloud planning and remote inference; it does not enable any paid provider.
Existing credentials and unrelated configuration are preserved.

To let SEER select an ID from the LiteRT registry instead:

```bash
jaco restart --provider litert
```

An empty `JACO_LITERT_MODEL` means discovery. Activation no longer invents an E4B
filename. An installed llama.cpp binary/model cannot replace an explicit LiteRT
selection. In `auto` mode an available LiteRT registry takes precedence.

Workplace reuses a healthy LiteRT server already running at
`http://127.0.0.1:9379/v1`; otherwise it starts `litert-lm serve` through its
existing supervisor. Activation saves the resolved CLI path because the
interactive shell and runit can have different PATHs. A custom installation can
set `JACO_LITERT_COMMAND`. Keep one supervisor; do not launch another SEER merely
to make the port answer.

## Verify each connection

```bash
curl --max-time 5 -sS http://127.0.0.1:9379/v1/models
curl --max-time 5 -sS http://127.0.0.1:2997/health
```

The first response must contain the selected ID. SEER's `local_model` must show
`provider: "litert"` and the same `model`. A healthy SEER with `local_model: null`
has not connected to a model. `local_model_discovery.lastReason` reports discovery
errors, including underlying connection codes such as `ECONNREFUSED`.

Aura's provider catalog now includes LiteRT from the same runtime env. Select
**SEER** in Aura's chat settings to send the conversation through the coordinator;
selecting **litert** is a direct manual-provider chat and does not change SEER's
selection. Send `Svara endast GEMMA_GUI_READY` and check the resulting provider
receipt. Registry discovery and health alone do not prove an Aura completion or
an autonomous mission. Workplace starts Nova only after its SEER inference probe
succeeds.

## Checks in Git

```bash
bash runtime/gateway/test/jacoctl.test.sh
bash runtime/gateway/test/termux-model-selection.test.sh
node --test gateway/test/seer-model-provider.test.mjs tests/nova/aura-provider-registry.test.mjs tests/nova/aura-provider-choice.test.mjs tests/workplace/workplace-supervisor.test.mjs
```

The shell suite uses isolated service/process fixtures. These checks verify
configuration and routing behavior; target-device startup and a real Gemma
completion must be verified on the installation.
