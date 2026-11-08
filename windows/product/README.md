# JACO CODE for Windows

This is the canonical **full runtime** Windows product, not the portable JACO Lite ZIP.
A Windows GitHub Actions runner installs Node 24 dependencies, builds the real runtime,
assembles a production payload and compiles an Inno Setup \`JACO-Setup-X.Y.Z-win-x64.exe\`.

- Setup requires **Windows UAC administrator consent**; binaries install under
  \`%ProgramFiles%\JACO CODE\`. The running JACO application never requires admin rights.
- Start menu and optional Desktop shortcut: **JACO CODE**.
- Initial app state, private tokens, mission ledger and startup logs: \`%LOCALAPPDATA%\JACO\`.
  **Uninstall does not erase user data**. Reinstallation reuses existing settings.
- The GUI checks the GitHub Releases *stable* channel, not unmerged commits or
  the development branch. A **new signed-off Windows installer artifact** is required.
- The update announcement opens the official GitHub installer download. Installer execution
  requires the user's explicit action and Windows UAC; no model can silently elevate.
- A tag \`vX.Y.Z\` must match \`windows/product/version.json.version\` before publishing. The Windows desktop distribution version is separate from the canonical Android/Termux runtime identity.
  A checked Windows artifact and accompanying SHA256 checksum are attached to that release.
- CI cannot guarantee trust by itself: configure Authenticode signing and perform a clean
  Windows install/start/update/uninstall smoke test before calling public distribution GA.

### Local release testing
Workflow: \`.github/workflows/jaco-windows-release.yml\` (manual build, no publish).
Publishing: push a matching stable version tag on reviewed main. Code-signing remains a release gate.

### State / rollback
Installations do not delete \`%LOCALAPPDATA%\JACO\`. The installer overwrites product binaries,
so database schema migrations and rollback still require validation on a disposable test user.
Do not point the installed \`JACO_DATA_DIR\` into Program Files.

## Optional phone Remote, without Cloudflare

The full Windows installer now includes **JACO Private Remote Setup** in the
Start menu. It is opt-in and never runs during installation. To use the same Aura
from Android without opening router ports or managing a Cloudflare Tunnel, sign
in to Tailscale on Windows and Android, start JACO locally, then launch this
setup command. The private HTTPS address appears in **Devices → Add device →
Browser** after restarting JACO. Pair with the one-time code and install the
Remote PWA on Android.

This requires Tailscale on both devices. It is a deliberately simple **private
first transport**, not a JacoCloud installer or a finished zero-install public
relay. Read [JACO Private Remote](../../docs/jaco-private-remote.md) for
verification, security, limitations and rollback.
