# Local photoreal avatar provider experiment

## Proposal and design
Extend the existing AuraPortrait (not a second chat, voice engine or agent) with an explicitly selected local Gaussian-splat renderer. Keep the existing rig as default. The operator supplies a head they have permission to use and redistribute if applicable. No API key, account, paid endpoint, or sample face download. No new camera or microphone access. Existing speech playback remains authoritative; only its captured audio stream is analysed, never rerouted to speakers. No full-duplex claim.

## Research protocol
Baseline: existing Aura rig and voice on matched utterances and hardware. Hypothesis: an animatable Gaussian-splat asset improves realism without disrupting mission or voice execution. Null: no improvement or unacceptable latency/quality. Compare against original rig using at least 20 held-out utterances (10 Swedish, 10 English), quiet listening and a 10-minute active mission on Windows Chrome and Android Chrome. Record actual frames, median/p95 frame time, speech/visual timing using captured audio and mouth motion, CPU/memory, failures, operator-rated naturalness. Target >= 25 fps median, <= 60 ms p95 frame time, <= 150 ms absolute mouth/audio lag, no duplicate playback, mission changes or unsolicited permissions. Fail on any privacy leak or undisclosed fallback; compare reduced-motion behavior and test renderer initialization errors. These are prospective thresholds, not results. No paid resources.

Upstream: https://github.com/payner35/avatarz/tree/54dcccf96f3d73aa58474c51c3417bae484e577c (MIT code). README says sample splat bundles lack explicit asset license; never fetch or ship those automatically. Splat renderer uses a LAM-compatible head ZIP; a normal portrait JPEG is not sufficient. Initially use the upstream formant extractor as an experimental audio-driven baseline, not a neural phoneme model. HeadAudio and Wav2ARKit require separate dependency/weight provenance checks. The upstream splat renderer temporarily patches the canvas prototype when transparent; use an opaque background to avoid that code path. Install only reviewed local files from the pinned build; same-origin executable assets are trusted operator-installed code, not an arbitrary URL. No runtime network requests to third parties by the integration. No promise about unreviewed upstream dependency behavior.

## Spec delta
- Opt-in photoreal mode SHALL be selectable only as presentation; default rig remains unchanged.
- Missing local assets, reduced motion, unsupported audio/WebGL or initialization failure SHALL report failure without claiming photoreal readiness; chat and mission remain available.
- The provider SHALL release owned audio and render resources on disposal, not disconnect or stop the existing audio playback or microphone.
- The provider SHALL never request or automatically download a third-party face.
- Switching renderer SHALL NOT submit chat, change mission state, or authorize paid services.

## Tasks
- [x] Inspect canonical AuraPortrait, existing speech path, upstream API and license.
- [ ] Implement local-only experimental integration and provisioning.
- [ ] Verify deterministic lifecycle and state routing.
- [ ] Verify dependency/asset licensing and actual local artifact build.
- [ ] Verify physical desktop and Android performance, synchronisation and visual quality.
- [ ] Merge only after relevant CI and acceptance evidence.

## Serving and rights (review follow-up)
- The head is a real person's likeness. The installer writes the bundle to `runtime/local/aura-splat` (git-ignored, outside `public/`), so neither `express.static` nor the client build can expose it. The runtime serves `/aura-splat` through one guarded route (`runtime/src/server/auraLocalAssets.mjs`): loopback peer only, no proxy headers, and no signed-in remote IDE session. A refused request gets the same 403 whether or not the file exists.
- A copy left under `public/aura-splat` by an earlier layout is shadowed by that route and not served; startup warns, and a client build would still copy it.
- The installer requires `--confirm-likeness-rights` and a rights notice that is readable UTF-8 text (at least 40 characters and 8 words, at most 1 MiB). It records the sha256 of the head and the notice in `PROVENANCE.txt`. This is a statement by the operator, not verified legal clearance.
- Falsifier: a request through a proxy or from a remote IDE session that receives `head.zip`, or an installer run without the flag that installs. Unobserved: the real `requireLocalUi` behind a real tunnel, a real install (needs network and a rights-cleared head), Windows and Android paths.
