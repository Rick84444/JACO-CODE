# Windows installer

`JACO-Setup-<version>-<architecture>.exe` wraps the existing canonical downloadable runtime built by `tools/build-lite.mjs`. It installs the Aura workspace, its execution agent, its bundled tools and local coordination service. Optional repository services are not implied by this installer. The product does not replace Windows.

Setup requires Windows 10 or newer and the matching native architecture (`x64` or `arm64`). It installs for the current user without administrator access. The normal flow shows an installation agreement, optional desktop shortcut and optional sign-in startup. The last page offers to open the connection guide. Model-provider access, environment-file import, local discovery and execution permissions are reviewed inside that guide; accepting the installer is not a grant for those actions.

## Build

Install locked runtime dependencies, build and verify the canonical package, then run NSIS 3 on the staging folder from that exact commit:

```sh
JACO_BUILD_SOURCE_COMMIT="$(git rev-parse HEAD)" node tools/build-lite.mjs
node tools/verify-lite.mjs build/lite/platforms/jaco-lite-windows-0.22.0.zip
node tools/build-windows-installer.mjs \
  --stage build/lite/stage/jaco-lite-0.22.0 \
  --out build/installers \
  --arch x64 \
  --source-commit "$(git rev-parse HEAD)"
```

On a Windows runner, NSIS can be installed with `choco install nsis --no-progress -y`. Pass its executable with `--makensis "C:\Program Files (x86)\NSIS\makensis.exe"` if it is not on PATH. The builder itself runs on Linux or Windows; the resulting installer runs on Windows.

The builder downloads `SHASUMS256.txt` from `https://nodejs.org/dist/latest-v24.x`, selects one exact architecture-specific Node.js 24 archive, verifies its checksum and checks the PE architecture of `node.exe`. npm, npx and their dependencies come from that same verified archive. It also downloads the matching MinGit archive from the official `git-for-windows/git` GitHub release, requires the asset's published SHA-256 digest and verifies the archive and `git.exe` architecture. The receipt retains both archive digests and official download URLs. Bundled tools are added only to the child-process PATH; the Windows account's persistent PATH is unchanged.

For a controlled offline build, provide `--node-archive <official Node ZIP> --node-checksums <official SHASUMS256.txt>` together and `--git-archive <official MinGit ZIP> --git-checksum <official SHA256>`. No downloads, npm installation or source compilation occur during Setup on the user's PC. A browser remains the user's choice; browser-control tasks require a supported browser and their own permission.

Inputs with a missing runtime, mismatched client/server checksums, missing source-commit identity, symbolic links or private `.env`, `.jaco` or `.git` state are rejected. Every file in the staged payload is hashed again. NSIS compilation must finish successfully and produce a real PE file before a checksum or success receipt is written. Output is ignored by Git under `build/`.

The generated executable is **unsigned** unless a release owner separately signs it. The receipt says `signature: unsigned`; it does not assert publisher trust. Recompute the final checksum and receipt after applying a signing step, since signing changes the bytes. A checksum detects corruption; it is not a Windows code-signing certificate.

## Installation, updates and removal

Application binaries live in `%LOCALAPPDATA%\Programs\JACO\versions\<build-id>`. Workspace and credentials live in `%LOCALAPPDATA%\JACO\workspace`, and desktop startup diagnostics in `%LOCALAPPDATA%\JACO\logs`. `JACO_WORKSPACE_ROOT` can point to an operator-selected workspace. Setup does not import or traverse it.

Setup verifies a pending version before moving it into its immutable version folder and atomically replacing `current.json`. The previous version is retained. A failed verification or activation keeps the current pointer. Reinstalling the same build verifies and reuses it instead of overwriting files in use. Installing an older version or changing native architecture in place is refused. Retained binary versions can be removed by uninstalling; user data stays separate.

The Start menu contains **JACO** and **Stop JACO**. A local named pipe prevents double-clicking a shortcut from starting a second runtime. It only accepts open, status and stop; the canonical runtime launcher remains the service owner. An update waits for the running installation to stop. Uninstall asks that same launcher to shut down and stops if shutdown cannot be verified. It removes the application, its shortcuts and its current-user sign-in entry, and preserves workspace data and credentials.

Silent installation is for explicit deployment/testing: `JACO-Setup-<version>-x64.exe /S /ACCEPT=1`. `/S` without `/ACCEPT=1` is refused. Normal end users should use the interactive installer. Silent Setup does not launch the runtime or accept the separate connection guide.

## Windows acceptance

Run `node --test tests/nova/windows-installer.test.mjs` for packaging, integrity, activation, downgrade and running-process refusal tests. These do not prove installation on Windows.

On a fresh Windows CI account, run `packaging/windows/verify-install.ps1 -Installer <built EXE> -ExpectedCommit <source SHA>`. It installs the emitted executable, checks the bundled Node/npm/Git, validates the runtime identity and initial permission gate, saves explicit test consent with all optional grants disabled, observes the restart, checks duplicate-launch prevention and uninstalls while preserving the test workspace. It writes a separate `.windows-host.json` report. It refuses to overwrite an existing JACO installation. This acceptance is not a Windows sign-in or reboot test.

On a clean Windows test account:

1. Start Setup normally, inspect the agreement and keep sign-in startup unselected. Finish installation and open JACO. The connection guide must appear before grants, API calls or task execution.
2. Confirm the JSON runtime identity, save one approved provider connection and complete one bounded task. Double-click the JACO shortcut again; it must reopen the same runtime rather than start another one.
3. Select Stop JACO, install a newer exact build, then restart. Verify retained workspace/settings, matching source identity and the new version. Uninstall and verify application/shortcut removal while the separate data folder remains.

The `.receipt.json` describes build verification and leaves Windows host installation and startup `unobserved`. Record host observations separately rather than turning a successful build into a claim about a real user machine or reboot.
