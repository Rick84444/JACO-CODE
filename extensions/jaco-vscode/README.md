# JACO Cognitive IDE — VS Code extension

This VS Code extension opens **the complete existing JACO GUI** inside a full-size editor tab. It does not copy the app into VS Code, create a second runtime, invent agent state or bypass JACO's auth policy. JACO chat, missions, projects, Git and MCP remain owned by the same running local JACO Core.

## Install for development

Open `extensions/jaco-vscode` as a VS Code extension development project (F5 in an Extension Development Host) or package the folder with VS Code's `@vscode/vsce` into a `.vsix`, then choose **Extensions: Install from VSIX...**. This source change does not automatically publish to the VS Code Marketplace.

VS Code 1.96+ is required. The extension uses Node's built-ins and needs no runtime npm dependencies.

## Enable full embedding locally

JACO ordinarily sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` to prevent clickjacking. The extension does **not** strip those headers or create an unauthenticated reverse proxy.

1. Install an updated JACO Core containing `runtime/src/server/security/vscodeEmbed.mjs`.
2. Enable `JACO_VSCODE_EMBED=1` in the local JACO runtime environment and restart JACO. **Or** use the extension's **JACO: Start Runtime** command from the JACO-CODE checkout; this explicit terminal action sets the opt-in flag for the launched process.
3. In VS Code, run **JACO: Open Full IDE** or click **JACO** in the activity bar, then **Full JACO IDE**.
4. Configure `jaco.runtimeUrl` only if your local JACO Core uses a nondefault port. The default is `http://127.0.0.1:3000`.

The extension verifies `/api/runtime/identity` and a dedicated `GET /vscode-embed` response before displaying the iframe. It never treats a generic HTTP 200 as a healthy JACO runtime.

The `/vscode-embed` exception is deliberately limited to **direct loopback GET/HEAD requests** when opted in. It relaxes only the page's framing headers for VS Code webview origins. Normal `/`, API responses, other pages, external tunnels and cross-origin mutation rules retain their standard protections. JACO's browser-only command routes are not granted to the extension host.

## Open from the JACO GUI

The VS Code button in the JACO GUI's left rail opens `vscode://jacocode.jaco-cognitive-ide/open`, which runs **JACO: Open Full IDE** in VS Code. The browser or VS Code may ask you to confirm. The extension accepts only that fixed path and no parameters. The button is hidden for remote viewers and inside the VS Code tab itself. The extension also activates at VS Code startup so the status bar item is always available.

## Extension commands

- **JACO: Open Full IDE**: open the existing JACO GUI in a VS Code editor pane, preserving the original functions and layout.
- **JACO: Start Runtime**: start the canonical JACO CLI from a *trusted* local checkout in an integrated terminal. It does not install dependencies, close existing services or guarantee READY.
- **JACO: Open Terminal IDE**: enter the existing `jaco ide` command experience in the integrated VS Code terminal.
- **JACO: Open in External Browser**: open the original local GUI without any embed opt-in.

The activity-bar JACO view and bottom-left status item expose the main command. Set `jaco.checkoutPath` to the absolute JACO-CODE path if you are developing a different project and want to launch JACO from that project.

## Integration with Git, MCP and mobile

JACO's full GUI already includes its Git, MCP and Devices features. This extension renders those existing views; it does **not** instantiate a new Git index, device registry, model agent or credential store. `jaco ide` and `/mcp install vscode` remain available through the canonical local CLI. Connected devices continue to pair through the JACO Devices view and authenticated hub flow.

**Scope of this first extension:** desktop VS Code with a local Core. VS Code Remote/SSH/Codespaces, browser-based VS Code, phone browser rendering and arbitrary remote JACO host URLs are not accepted or claimed as verified. WebSockets/port forwarding, device-to-host identity and actual target-host launch must be tested separately. `asExternalUri` helps with VS Code's local iframe transport, but remote proxies may trigger JACO's existing remote-host gate.

## Verification

Run `node --test extensions/jaco-vscode/test/*.test.cjs tests/nova/jaco-vscode-embed.test.mjs` from the repository root. Also run the Aura Workbench lint/build/production smoke gate. A real VS Code Extension Development Host and real browser launch are necessary to establish GUI acceptance; CI unit tests alone do not prove that a rendered webview loaded.
