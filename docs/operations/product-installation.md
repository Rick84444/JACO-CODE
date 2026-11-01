# JACO installation and first start

JACO OS is installed as an application on the existing operating system. It does not replace Windows or Android.

## Windows

The product installer workflow builds `JACO-Setup-<version>-x64.exe` from the canonical runtime, with an exact source commit in its release receipt. Setup installs for the current user and shows an installation agreement. Desktop and sign-in shortcuts are optional. The installed application opens Aura in the user's browser.

No repository checkout, source compilation or npm installation is required on the user's machine. Setup includes the production runtime and dependencies. The Windows package includes a checksum-verified official Node.js distribution and portable Git. Project-specific dependencies, test tools and browser automation remain project/device prerequisites; the installer does not claim they are present.

The first start opens Setup before agent execution or provider discovery. The operator chooses English or Swedish, automatic model discovery, bundled tools, task execution and cloud-model access. Cloud access is off until explicitly enabled. This writes installation preferences and updates the existing economic policy; it does not create a second permission or budget system. Existing monetary caps are retained. No cap is added automatically.

The launcher stops its exact child processes, waits for their exit and restarts the workspace with the saved choices. Unknown shutdown blocks restart. Opening Setup later saves changes for the next launch.

## Android

There are two distinct downloads:

- `JACO-Android-preview.apk`: the native local model engine and a guided connection to Aura, with optional notification/accessibility permissions and English/Swedish text. Android asks the user to allow installation. The preview uses debug signing; production upgrades need an operator-owned stable signing key.
- `jaco-lite-android-<version>.zip`: the same built Aura runtime and executor, launched inside Termux using `START-ANDROID.sh`. First start opens the same consent and connection flow. The APK alone does not install the Node/Termux runtime.

Android's app sandbox does not allow JACO to read arbitrary environment files from another app. The operator can select a file in the setup page; only recognised model API keys are imported into the existing credential store. JACO does not execute environment-file contents or search the phone for credentials.

An Android native model is available to Aura only after a one-use local pairing challenge verifies the authenticated engine. A loaded model is exposed through the existing provider registry and an authenticated local model adapter. A healthy engine without a loaded model advertises no usable models. Pairing, model-list discovery, inference and task completion remain separate checks.

## Provider and MCP setup

“Find local models” probes only the known loopback ports for Ollama, LM Studio, LiteRT and llama.cpp. It does not scan a LAN, search user folders, run installation commands or infer tool capability from a model list. An environment file is read only after explicit import selection. Existing keys are preserved; values never appear in the response or the chat.

The optional MCP connection buttons extend the existing client configuration for Codex, Claude Code or VS Code. Existing settings are backed up and existing JACO entries are not overwritten. The client must reload and approve its connection. The project tool check is a real read-only invocation and does not claim the external client is connected.

The installed runtime includes Aura, its existing task executor, local coordination and bundled project tools. Optional strategic planning, browser automation and remote publication depend on their configured services. Missing services remain visibly unavailable. No tunnel or public access is created by Setup.

## Release evidence

Run `JACO product installers` for the exact source commit. Its Linux job checks the package and performs a real first-start/consent/restart/shutdown acceptance. Its Windows job compiles Setup and installs it on an ephemeral Windows runner, then checks first start, saved consent, restart, stop and uninstall with user data retained. The Android workflow runs Kotlin tests, APK assembly and Android lint.

These checks do not prove startup after an actual user's Windows sign-in, Android installation on a physical phone, native inference on that phone or a completed external-provider task. Before calling a release production-ready, observe those relevant target-device checks and production signing. Workflow artifacts and checksums are build downloads, not an automatic public release.
