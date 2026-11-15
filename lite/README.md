# JACO Lite

The JACO IDE on your own computer, free, with your own AI models. One folder, one command.

## Install (recommended)

One command installs JACO Lite, checks the download against its SHA-256, brings its own Node.js if yours is older than 22.5, needs no administrator rights and keeps everything in one folder:

```sh
# Windows (PowerShell)
irm https://jacocode.com/install.ps1 | iex

# Linux, including the Pixel Debian VM (experimental, not physically verified)
curl -fsSL https://jacocode.com/install.sh | sh
```

Then, in any project folder: `jaco-lite`. Later:

| Command | What it does |
| --- | --- |
| `jaco-lite update` | installs the newest build; the previous one is kept |
| `jaco-lite rollback` | goes back to the previous build |
| `jaco-lite doctor` | shows what is installed and whether it can start |
| `jaco-lite uninstall` | removes it (your projects and `~/.jaco` are not touched) |

Where things go: `~/.local/share/jaco-lite` on Linux (`~/.jaco-lite` in Termux) and `%LOCALAPPDATA%\JACO Lite` on Windows, with the `jaco-lite` command in `~/.local/bin` (Windows: the folder is added to your user PATH, plus a Start menu entry). Options are environment variables: `JACO_LITE_HOME`, `JACO_LITE_BASE_URL`, `JACO_LITE_NO_MODIFY_PATH=1`, `JACO_LITE_NO_SHORTCUT=1`; the top of each script lists them. Read the scripts first if you like: [install.sh](https://jacocode.com/install.sh), [install.ps1](https://jacocode.com/install.ps1).

The Node.js it downloads is the official build from nodejs.org, checked against nodejs.org's `SHASUMS256.txt` over HTTPS (not against the GPG signature).

## Start from the zip

You need Node.js 22.5 or newer (`node --version`). Unzip this folder, then:

```sh
node start.mjs                 # opens the folder you ran it from
node start.mjs ~/my-project    # or a specific project folder
```

On Windows you can double-click `START.cmd`; on macOS and Linux run `./start.sh`.

### Pixel Terminal (Android Linux, Debian VM) — primary on-phone runtime

Use the **built-in Pixel Linux Terminal**, based on Android Virtualization Framework (AVF).
It is a separate Debian VM, **not Termux** and not the Android host shell.

1. Enable the Linux development environment in Android developer options and open Terminal.
2. In Debian, install the base tools: `sudo apt update && sudo apt install -y git curl ca-certificates unzip`.
3. Install Node.js **22.5+** for Linux arm64 and check `node --version` and
   `node --experimental-sqlite -e 'require("node:sqlite")'`. Debian's packaged
   Node version might be too old; the launcher intentionally refuses unsupported versions.
4. Unpack a complete, checksum-verified **JACO Lite Android** release ZIP *inside
   Debian*. From the extracted folder:
   ```sh
   bash START-PIXEL-TERMINAL.sh --check
   bash START-PIXEL-TERMINAL.sh
   ```
5. Copy the **actual URL printed by JACO** into Pixel Chrome. The VM forwards
   localhost ports to the host browser on supported builds, but this must be
   observed on the physical Pixel. The JACO server remains bound to VM loopback.
   The VM cannot access Android app-private storage or the Android-native
   LiteRT service merely by using `127.0.0.1`.

This creates a **separate JACO Lite instance** in the Debian VM, with its own
project and local state in `~/jaco-pixel-project`. It does **not** inherit the
Windows Aura mission IDs or memory. To control the existing Windows Aura, use
JACO Link through `https://jacocode.com/link/remote.html`, with the existing
Windows host paired and the service actually deployed. The native Android APK's
on-device LiteRT model is another local inferencing option and does not require
the VM. The LiteRT service is **not** automatically reachable from the Debian VM.

**Status:** Source implementation and CI are not physical Pixel acceptance.
Verify native Node dependencies on Linux arm64, port forwarding, login/model
access, VM suspend/restart behavior and resource use before describing it as
installed or operational on a particular device.

### Legacy Android / Termux (not the intended Pixel path)

The old `START-ANDROID.sh` launcher is retained for compatibility with
existing Termux installations. The Pixel deployment uses
`START-PIXEL-TERMINAL.sh` instead.

### Gameboard and simulation
The `Spelplan` tab in Cognitive Live Workspace reads `/api/aura/workbench/gameboard` and shows stable numeric agent and MCP-tool IDs and, where SEER is connected, observed mission-graph forecasts. The simulation control accepts assumptions for a hypothetical tool chain; it neither invokes a tool nor claims a verified outcome. A Lite install without SEER reports `UNAVAILABLE` for the canonical strategic graph, rather than faking it; the hypothetical scenario simulator remains available. The durable revisioned exchange stores agent `OBSERVATION`, `HYPOTHESIS` and numeric `MOVE_PROPOSAL` entries with optimistic locking. Entries are self-reported, not verified and cannot invoke an executor. JACO Editor MCP exposes `gameboard_status`, `gameboard_events` and `gameboard_simulate` as read-only tools, plus the Workplace-synchronized `gameboard_publish` operation for clients that connect locally. Public ChatGPT access still requires the authenticated remote JacoEdit transport from PR #142 and its secure OAuth/Cloudflare deployment.


On Windows, first right-click `jaco-lite.zip` and select **Extract All**. Open the
extracted folder and run `START.cmd` there. Running it inside the ZIP opens only
the batch file in a temporary folder, leaving `start.mjs` and the runtime behind.

The first line it prints is the address (by default `http://127.0.0.1:3000`). Your browser opens on it.
Stop it with Ctrl+C.

## First start and connections

The browser opens JACO's Cognitive Live Workspace: one conversation with live work, code, preview and evidence. JACO starts its own local Workplace service on a free port and includes the JACO Editor MCP server; you do not install these separately. Available local models and cloud providers with credentials already saved in JACO are connected automatically. The model panel is an optional override. The optional external-editor connection guide is at `/connect.html`.

Choose Codex, Claude Code or VS Code to save the connection. Existing settings are kept with a backup. Existing JACO entries are left unchanged for review. Reload the client's MCP connections and approve the server there if requested. The guide can run a real read-only JACO Editor tool check; this does not claim the external client is connected.

The guide is always at `/connect.html` on the address printed by the launcher. Mobile/Cloud pairing uses your own installation's configured HTTPS address and the IDE's Devices view. No public address or tunnel is created automatically, and the computer must remain on. Local work does not require Cloud.

## Connect a model

JACO discovers running local models and uses credentials already configured in its environment or encrypted store. You can optionally override this from chat settings:

- **Ollama or LM Studio** running on this computer are found automatically, with the models they have.
- **A cloud provider** (DeepSeek, Groq, OpenAI, OpenRouter, Together, Mistral, Hugging Face and others):
  paste its API key and JACO works out which service it belongs to and checks it.
- **Any other OpenAI-compatible server:** enter its address.

Keys are kept in `~/.jaco` (outside your project), sealed with AES-256-GCM. The key file sits next to
them, so this protects against accidents (git, screenshots, backups of the project), not against
someone who can already read your user account. Nothing leaves your computer except the requests you
send to the provider you connected, and one public file, `jacocode.com/download/latest.json`, that Lite fetches
at start to tell you if a newer version exists (it carries nothing about you or your project, but the request
reaches our server logs like any visit). It never downloads or installs anything by itself. Turn it off with
`JACO_LITE_NO_UPDATE_CHECK=1`.

## Options

| Option | Meaning |
| --- | --- |
| `--port N` | use this port (default 3000, or the next free one) |
| `--no-open` | do not open the browser |
| `--check` | check this installation and print what would start |
| `--verbose` | also print the server log (it is always saved in `<project>/.jaco/lite.log`) |

## What is in the box

- `dist/` the built IDE and its server, `node_modules/` the packages it needs (nothing is downloaded
  when you start it), `start.mjs` the launcher.
- The server listens on `127.0.0.1` only. It keeps its state in `<project>/.jaco`, which has its own
  `.gitignore` so it stays out of your project's git history.

Lite includes the IDE, Aura chat, Nova, local Workplace coordination and the JACO Editor MCP server, all with your own providers. The SEER planner and a managed public Cloud connection are not part of this download.

## Give Nova a goal

Nova changes code in a project that is a git repository with at least one commit (`git init` and a first
commit if it is not; the IDE tells you when it is missing). Write the goal in the chat, choose "Mission" and press "Start mission". Use "Ask" to discuss observed work while that mission continues. Nova then:

- works on its own branch, `jaco/mission-...`, in a separate worktree. Your branch and files are not touched,
  and it never pushes or merges;
- requires the project's own tests (for example `npm test`) to pass after its last change before it reports done;
- uses whichever model you connected, local or cloud.

Autonomy defaults to level 5: verified work, typed jobs and staged MCP sources proceed within the existing contracts and budgets. Existing explicit autonomy settings are respected. Unknown results, policy stops and outgoing purchases are not automatically approved. Describe desired boundaries in the conversation; the agent must distinguish discussion from a saved, enforceable policy. Cloud
spend has no caps until you set them: turn on a daily, monthly or per-task limit in the IDE's budget panel (or in
`<project>/.jaco/continuum/economic-policy.json`); an empty field means no cap. Lite never overwrites your changes.

Licensed under the MIT License (see `LICENSE`).
