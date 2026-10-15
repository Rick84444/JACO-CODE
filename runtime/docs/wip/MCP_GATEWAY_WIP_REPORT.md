# JACO Autonomus IDE 0.19 WIP — MCP Gateway / Android Activation Report

## Classification

**WORK IN PROGRESS. NOT A RELEASE.** The frozen 0.18.0-RC1 remains unchanged. This tree is a separate 0.19 integration branch.

## Implemented in this WIP

### Sentinel / activation plane

- Loopback-only default Sentinel: `127.0.0.1:2999`.
- Canonical JACO Core stays on `127.0.0.1:3000`.
- Sentinel endpoints: `/health`, `/api/system/status`, `/api/system/activate`, `/api/system/deactivate`, `/mcp`, activation HTML.
- Local HTML mutation requires a per-process activation nonce; HTTP does not accept arbitrary shell commands.
- Remote-capable gateway mode refuses startup without a bearer configuration.
- Explicit Host and Origin parsing is applied before the MCP handler.

### Official MCP SDK migration

Gateway package pins:

- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/node@2.0.0`
- `@modelcontextprotocol/client@2.0.0` for runtime tests

HTTP uses official `createMcpHandler`; stdio uses official `serveStdio`. The previous hard-coded `2024-11-05` protocol loop is not used by the new gateway.

### Semantic MCP surface

12 tools are defined:

1. `jaco_identity`
2. `jaco_system_status`
3. `jaco_system_activate`
4. `jaco_hands_off_status`
5. `jaco_browser_targets`
6. `jaco_browser_attach`
7. `jaco_browser_survey`
8. `jaco_nova_begin`
9. `jaco_nova_target`
10. `jaco_mandates`
11. `jaco_relay_action`
12. `jaco_browser_receipts`

No raw shell, arbitrary `Runtime.evaluate`, credential-entry, or direct CDP websocket tool is exposed. A model cannot sign its own autonomy mandate.

### Termux activation

- `bin/jacoctl`: fixed lifecycle verbs only: activate/deactivate/status/restart.
- `bin/jaco`: stable user-facing lifecycle alias.
- `termux-services` / runit service definitions for Sentinel and Core.
- `termux/install-activation.sh` installs activation dependencies and service definitions.
- Optional Termux:Boot script starts the runit service daemon; Sentinel is enabled, Core remains on-demand.
- Core activation waits for the canonical `:3000/api/runtime/identity` endpoint.

### OpenAI Secure MCP Tunnel compatibility

`bin/jaco-tunnel` is a narrow helper around the official `tunnel-client` runtime flow. It:

- targets only `http://127.0.0.1:2999/mcp` by default;
- requires an already-authorized `tunnel_id` and runtime key supplied in the environment;
- never serializes the literal runtime key into a generated command/config;
- never targets Chrome `:9222`;
- does not create/manage OpenAI organization tunnels or permissions.

## Observed tests in this build environment

- inherited truthful-runtime gate: **15/15 PASS**
- inherited Frozen Hands-Off invariants: **49/49 PASS**
- inherited 0.18 gate: **32/32 PASS**
- new gateway WIP gate: **28/28 PASS**
- gateway Node unit/boundary suites: **3/3 PASS**
- `jacoctl` fake-runit lifecycle test: **PASS**
- `jaco-tunnel` fake-client command/key-reference test: **PASS**
- gateway `.mjs` syntax: **PASS**
- activation shell syntax: **PASS**

## Not yet verified

- Official MCP v2 runtime handshake, because npm package installation could not complete in this build environment; registry requests failed with `EAI_AGAIN`/DNS unavailability.
- Physical Termux `termux-services` activation on the user's Android device.
- Physical `tunnel-client` Linux ARM64 execution under Termux/Android.
- A real OpenAI Secure MCP Tunnel session; it needs platform tunnel permissions, a tunnel ID and a runtime key.
- ChatGPT full-write MCP availability for the user's current ChatGPT plan/client.
- Physical Browser/Desktop/Android actuation remains host/device work.

## Immediate Android acceptance sequence

After this WIP is intentionally transferred to the device (do not overwrite the current canonical runtime blindly):

```bash
cd <JACO-0.19-WIP>
bash termux/install-activation.sh --boot
# restart the Termux shell once so termux-services startup is sourced
jaco status
jaco activate
curl -s http://127.0.0.1:2999/health
curl -s http://127.0.0.1:3000/api/runtime/identity
jaco-tunnel preflight
```

The MCP runtime test should only be run after the official SDK dependencies install successfully:

```bash
cd gateway
npm test
```

## Promotion blockers

Do not call this 0.19 RC until:

1. official SDK installs and MCP HTTP/stdio negotiation tests pass on target;
2. Sentinel/Core lifecycle works across Termux restart;
3. truth audit removes or visibly labels all simulation leakage;
4. legacy MCP UI/routes are migrated or explicitly marked legacy;
5. Browser/Android/Windows adapters have physical evidence for capabilities claimed;
6. at least one model-to-JACO closed loop returns a semantic verified receipt and continues to the next SEER cycle.
