# JACO

JACO is a local-first runtime for persistent, policy-bound and verifiable agent execution.

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

Setup installs dependencies in the root, runtime and MCP gateway (using lockfiles when present), **builds the canonical production client and server**, and creates a local gateway token in `.env` if none is configured. A failed build stops setup instead of reporting a successful installation. Existing configuration is preserved. Install and start Ollama with a downloaded model before starting JACO, or configure another supported provider in `.env`. Setup does not download models or call paid providers.

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

## Open-source release note

Do not publish the current private repository by simply changing its visibility. Historical commits previously contained credentials. A public release must be produced from a clean source snapshot after exposed historical credentials have been rotated or revoked.
