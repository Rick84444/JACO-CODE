# JACO Lite verified distribution

## Status

The release process is **manual**. A green CI run is not a release and merging code to `main` does not publish anything. The existing `site/` directory and its Cloudflare Worker deployment configuration are not present in this source repository; publication targets GitHub Releases, not jacocode.com. There is no public Lite release until the first release job actually succeeds.

The distributable is **JACO Lite**, not a desktop OS image, a Windows Setup executable, nor an Android APK. The Android archive remains experimental and requires a real Termux device acceptance test.

## CI and permissions

`.github/workflows/lite-release.yml` runs the Linux build/test/installer/uninstall gate and the Windows smoke/installer/cross-platform-archive gate on relevant PRs and pushes to `main`. It never publishes from those events.

Publication requires a human to:
1. Merge the verified changes to `main` (including the CI branch fixes).
2. Create an existing `vX.Y.Z` tag **at the then-current HEAD of `main`**, where `X.Y.Z` equals `runtime/package.json` version. The tag must point at that commit, not an arbitrary PR or old commit.
3. Manually start the `JACO Lite download` GitHub Actions workflow with `release_tag` equal to that tag and `confirmation` exactly `PUBLISH`. The tag push alone never publishes.
4. Optionally configure the `github-release` GitHub Actions environment with **required reviewers** for a second approval step. The environment name alone does not guarantee that an approval gate is configured.

Example **only after all PR checks pass and changes are merged**:

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
node -p "require('./runtime/package.json').version"
# If the runtime version still is 0.22.0, and v0.22.0 does not exist:
git tag -a v0.22.0 -m "JACO Lite v0.22.0"
git push origin v0.22.0
gh workflow run lite-release.yml --ref main -f release_tag=v0.22.0 -f confirmation=PUBLISH
```

Tag names must not be re-used or moved. Bump `runtime/package.json` and its lockfile before a future version and test that change normally.

## Publication contract

The workflow fails closed unless all of the following are true:
- The operator explicitly submitted `PUBLISH` and a well-formed stable SemVer tag.
- The checked-out tag resolves to the **current** `main` commit and the runtime package version.
- The Linux archive checks, install/doctor/update/uninstall and secret scanning pass.
- The Windows runner successfully installs/starts/uninstalls and executes the **same Linux-produced Windows archive** after checking its SHA-256.
- The staged `jaco-lite.zip`, `jaco-lite-windows.zip`, and `jaco-lite-android.zip` match `latest.json`, source commit, and version before upload.
- A new draft GitHub Release is created only after both CI gates pass; the release cannot overwrite an existing tag's assets.
- The draft is published as `Latest`, then exact public asset URLs and the `latest/download/latest.json` URL are fetched over HTTPS and compared **byte for byte** with the tested release files. Failures make the job red; the workflow attempts to retract publication if possible (immutable releases may prevent retraction).

Published assets include the three stable-name ZIPs, `latest.json`, `SHA256SUMS`, and copies of `install.sh` and `install.ps1`. `latest.json` records the original source commit and the SHA-256 of each ZIP.

## Public installation, after first verified release

```sh
# Linux/macOS / Termux (Android Termux support remains experimental)
curl -fsSL https://github.com/Rick84444/JACO-CODE/releases/latest/download/install.sh | sh
```

```powershell
# Windows PowerShell
irm https://github.com/Rick84444/JACO-CODE/releases/latest/download/install.ps1 | iex
```

The installer defaults to `https://github.com/Rick84444/JACO-CODE/releases/latest/download` for the manifest and archives, verifies downloaded ZIP SHA-256 before installation and supports an override with `JACO_LITE_BASE_URL`. The installer scripts and the ZIP archives are fetched from the same tested GitHub Release; neither depends on a mutable raw-main script. These public URLs will **not** work as installation endpoints before the first published GitHub Release.

This release process does not automatically deploy `jacocode.com`, configure Cloudflare, change DNS, publish a signed installer, or certify device-specific functionality. Those are separate acceptance gates.
