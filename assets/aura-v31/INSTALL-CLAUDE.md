# Aura V31 — Claude Code installation handoff

This is a candidate for local acceptance, not a production release. The source revision containing the tested optical, facial, body, behavior, secondary motion and reflection changes is `9eb810764f5e18b303b0863de284798e0e762ba9`, on `origin/aura/v31-integration` (PR #419). Do not merge or modify main for this installation. Preserve the existing local checkout and all uncommitted changes. Use Node.js 24 and the existing runtime package lock.

## Isolated Windows trial

From the existing repository, in PowerShell:

```powershell
git fetch origin aura/v31-integration
git worktree add --detach ..\JACO-Aura-V31 9eb810764f5e18b303b0863de284798e0e762ba9
Set-Location ..\JACO-Aura-V31
node --version
```

If that worktree already exists, inspect it instead of overwriting it. The model is separately supplied by the operator. Use the actual path of the original file, named Aura-V31-JACO.glb (or Aura-V31-JACO(1).glb). Required byte count 45,304,080; SHA256 ea9c4646cf197f042fa4a39ea8ecd5a438adb1b0865c8eddb0749d0915bd6129. Do not substitute the legacy avatar or the larger study archive.

```powershell
$glb = Join-Path $HOME 'Downloads\Aura-V31-JACO.glb'
Get-FileHash -Algorithm SHA256 $glb
node runtime/scripts/install-aura-v31.mjs "$glb"
node runtime/scripts/inspect-aura-v31.mjs runtime/public/branding/aura-anatomical.glb
npm --prefix runtime ci
npm --prefix runtime run build
```

If the filename or location differs, resolve the actual file locally. If only both verified parts are supplied, use `node runtime/scripts/install-aura-v31.mjs --parts "<directory>"`. The installer validates the binary before atomically installing it. A missing asset is a hard blocker for V31 acceptance. Do not commit credentials, local config, or generated artifacts. Preserve existing runtime identity, memory and policy; use the existing configured local installation, or a separately configured trial profile, without creating a competing Aura. Check the existing listener and configuration before starting a trial runtime; do not kill processes, overwrite secrets, or start a second runtime on the same port. To start the trial when the approved runtime is stopped and configuration is established, use `npm --prefix runtime start` from the trial checkout. Do not claim a live trial merely because the build passes.

## Acceptance and evidence

- Verify the original GLB hash and actual model loads (not legacy lightform); inspect the canvas data-avatar-version attribute for V31.
- Capture actual Operator Stage and portrait screenshots, plus full-body presentation and advance/return. Confirm natural eye direction, no visible clipping, grounded feet and adaptive floor reflection. Confirm the face continues moving while walking.
- Exercise Swedish speech with M/B/P, F/V, vowels and pauses. Check real audio-clock lip sync; the English-trained local classifier is experimental for Swedish.
- Check browser console for shader errors, hair/skin artifacts and dropped frames. Record frame timing on the Windows device and Android client. Do not confuse desktop reflection with mobile fallback.
- Collect exact commit, model SHA256, test output, screenshots/video and observed problems. The previous GitHub revision passed 46 directed tests and a real Chromium WebGL synthetic fixture. Original-model visual and device-performance acceptance remain open. No full cloth simulation, anatomical tear line, real SSS or mocap retargeting is implemented.

The original binary is deliberately not in GitHub as of this handoff. A local installation from the separately supplied file is sufficient for the trial. Do not merge until the real model and device evidence are reviewed.
