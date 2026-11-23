# JACO

JACO is a local-first runtime for persistent, policy-bound and verifiable agent execution.

JACO is an open source (MIT) AI coding agent and IDE that runs on your own computer and model. Its agent, Aura, plans, edits code on a separate git branch, drives a browser and speaks, and every action leaves a receipt. Download and docs: [jacocode.com](https://jacocode.com/) · [Hugging Face Space](https://huggingface.co/spaces/Rick8444/JACO-Autonomous-IDE) · [VS Code extension](https://marketplace.visualstudio.com/items?itemName=jacocode.jaco-cognitive-ide).

The model is replaceable. JACO owns the execution state around it: goals, tools, policy, durable mission state, verification, receipts and restart continuity.

## Product contract

A normal run should be understandable as:

```text
goal
  -> plan
  -> bounded tool execution
  -> observed result
  -> verification
  -> receipt
  -> durable state
```

JACO must not treat generated text, an attempted action or a passing transport call as proof that the intended result happened.

## Start

Node.js 24+ is required.

```bash
npm run setup
npm run jaco:start
```

Setup installs dependencies in the root, runtime and MCP gateway (using lockfiles when present), **builds the canonical production client and server on desktop (or the Termux Aura frontend with its native Rollup preflight on Android)**, and creates a local gateway token in `.env` if none is configured. A failed build stops setup instead of reporting a successful installation. Existing configuration is preserved. Install and start Ollama with a downloaded model before starting JACO, or configure another supported provider in `.env`. Setup does not download models or call paid providers.

### Pixel Terminal (Debian arm64)

In a full source checkout, run `npm run setup`. On Debian/Ubuntu arm64 (not Termux), setup prepares Chromium using the distribution package manager when missing, creates internal authentication, and launches the canonical stack with sandboxed headless CDP. Normal sudo authorization may be needed for apt. Missing browser support is explicitly reported, never represented as ready. Open the exact runtime URL printed after activation. Existing browser opt-out `JACO_ENABLE_CDP=0` remains honored; `JACO_SETUP_ACTIVATE=0` performs installation without activation. `JACO_PIXEL_SETUP=0` opts out of the Pixel-specific setup path. No separate Lite runtime is started. This is not yet physical-device qualification.

Then inspect observed activation state:

```bash
npm run jaco:status
```

The intended user experience is one activation path: JACO discovers the local runtime, tools and configured model providers and reports what is actually ready.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `agents/` | local execution compatibility layer, CLI and bounded repository/device tools |
| `gateway/` | planning, mission orchestration, provider routing and optional coordination services |
| `runtime/` | canonical product runtime |
| `lite/` | portable JACO Lite distribution and installers |
| `tests/` | regression and integration contracts |
| `docs/` | current architecture and operator documentation |

There should be one implementation owner per responsibility. Historical prototypes, duplicate UI/server generations, generated evidence snapshots and scratch deployment artifacts do not belong in active source roots.

## Runtime invariants

- A selected provider must be observed working before JACO reports it ready.
- Tool authority comes from runtime policy, not model output.
- Unknown execution outcomes fail closed.
- Mission/evidence state must survive restart where the capability claims persistence.
- Secrets stay outside model-visible output and committed source.
- External financial commitments require explicit operator approval.
- Completion claims require receipts or other observable evidence.
- Hardware, browser, provider and deployment claims require target-specific verification; unit tests are not substitutes.

## Development

Run the focused test for the subsystem you changed, then the affected repository gates.

Core regression entry points:

```bash
npm test
npm run test:workplace
npm run test:self-development
```

The canonical runtime must also build:

```bash
npm run build:server --prefix runtime
npm run build:client --prefix runtime
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) before submitting changes.

## Ownership and licence

JACO Code is owned by Dick Jacobsson and published under the MIT Licence; see
[LICENSE](LICENSE) for the terms and the copyright holder. "JACO", "JACO Code",
"MIMIR", "SEER" and "Nova" are names used by that owner for this project. The MIT
Licence grants rights to the software; it grants no rights to the names or to the
jacocode.com domain.

## Open-source release note

This repository is a clean source snapshot. Its root commit, `eebf427` ("JACO Code
0.22.0 release candidate"), has no parent: the release was produced from the
development repository with `tools/release-jaco-code.mjs`, which carries over no git
history, operator keys, wallet, account or contact data.

The development repository is a different matter. Its history did contain credentials.
Those must be rotated or revoked on their own merits, whether or not it is ever
published, and it must not be made public by changing its visibility.
