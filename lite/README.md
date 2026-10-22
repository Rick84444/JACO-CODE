# JACO Lite

The JACO IDE on your own computer, free, with your own AI models. One folder, one command.

## Install (recommended)

One command installs JACO Lite, checks the download against its SHA-256, brings its own Node.js if yours is older than 22.5, needs no administrator rights and keeps everything in one folder:

```sh
# Windows (PowerShell)
irm https://jacocode.com/install.ps1 | iex

# Linux, and Android in Termux (experimental, not verified on a phone yet)
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

### Android / Termux (portable Lite)
Install Termux and extract the **same JACO Lite ZIP** into Termux-accessible storage. From the extracted folder run:

```sh
bash START-ANDROID.sh
```

The launcher uses Node.js >=22.5, attempts to install `nodejs-lts` through Termux if needed, runs the identical bundled server and Codex Cognitive Live Workspace and keeps project state in `$HOME/.jaco`. Open the localhost URL printed by the launcher in your Android browser. **This is a Termux distribution, not an APK.** A packaged archive built on another OS is not guaranteed to work on Android until its dependencies and runtime are tested on a real device. Android device/Termux acceptance remains a release gate.

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
commit if it is not; the IDE tells you when it is missing). Write the goal in the chat, choose "Uppdrag" and press "Starta uppdrag". Use "Fråga" to discuss observed work while that mission continues. Nova then:

- works on its own branch, `jaco/mission-...`, in a separate worktree. Your branch and files are not touched,
  and it never pushes or merges;
- requires the project's own tests (for example `npm test`) to pass after its last change before it reports done;
- uses whichever model you connected, local or cloud.

Autonomy defaults to level 5: verified work, typed jobs and staged MCP sources proceed within the existing contracts and budgets. Existing explicit autonomy settings are respected. Unknown results, policy stops and outgoing purchases are not automatically approved. Describe desired boundaries in the conversation; the agent must distinguish discussion from a saved, enforceable policy. Cloud
spend limits start at the highest values the budget accepts (10 USD per task, 200 per day, 2000 per month), so nothing
stops work at first. Lower them in the IDE's budget panel or in `<project>/.jaco/continuum/economic-policy.json`; Lite never
overwrites your changes.

Licensed under the MIT License (see `LICENSE`).
