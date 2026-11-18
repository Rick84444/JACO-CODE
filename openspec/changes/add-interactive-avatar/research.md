# Technical research — avatar and adaptive workspace

## Evidence and decision
Source inspection of main: JacoAuraComputeIDE owns useCognitiveLive, pinned workspace selection, browser.cdp, terminal.open and /api/terminal/exec. CognitiveWorkspace owns responsive navigation. Do not duplicate. No code changes in this research pass.

- https://github.com/met4citizen/TalkingHead — MIT code; animation and GLB morph support. Example mpfb.glb is documented CC0; other example avatars have noncommercial terms. Verify exact asset provenance before redistribution.
- https://github.com/met4citizen/HeadTTS — MIT, Kokoro, phoneme timestamps and Oculus visemes, local Node CPU/WebGPU or browser WASM/WebGPU. Prefer Windows service initially, measure contention with LLM. English initially. Do not assume device support.
- https://github.com/InterviewFlowAI/talking-avatar — audio-driven visemes, MIT Rocketbox models, but documented no head/gaze motion. Alternative for arbitrary audio, not primary animation engine.
- https://github.com/met4citizen/HeadAudio — arbitrary audio fallback; upstream reports accuracy degradation in noise.
- https://threejs.org/docs/pages/Mesh.html — getVertexPosition includes morph/skinning. CPU reference: cache unique animated vertices, interpolate each sampled triangle using fixed barycentric weights; compare GPU output against reference. Static sampling insufficient. Benchmark before choosing GPU path.
- https://xtermjs.org/docs/guides/security/ — bundle locally, untrusted terminal data, no unrestricted shell transport. First integrate display with existing sanitized event stream and authorized command form; PTY only with separate threat model.
- https://chromedevtools.github.io/devtools-protocol/tot/Page/ — experimental screencast, bounded in-flight frames and ACK. Reuse authenticated browser controller; frame target and revision correlation; read-only first. No raw CDP endpoint exposed to remote client.
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay — audio requires user activation in common browser configurations; offer explicit enable and text fallback, avoid repeated playback.
 
## Falsifiable gates (proposed, not measured)
1. Rig asset license and bundled notices verified; no network CDN script in privileged workbench.
2. Compare particle positions against CPU reference across mouth, blink, head motion. GPU result maximum error <= 1 mm in model scale, no static face during speech.
3. Android and Windows actual Chrome: p95 frame time <=33.3 / 16.7 ms respectively during active avatar on specified test hardware; adapt quality. Background rendering stops; context loss does not stop mission.
4. Human blinded voice comparison of at least three English voices using same sentences; record preferred voice, intelligibility and prosody; measured audio/viseme offset target <=80 ms. No browser TTS fallback masquerading as neural speech.
5. Replay and reconnect tests: notification IDs deduplicated, stale events never auto-speak, pinned active view preserved, closing popup never cancels mission, audio cannot play twice.
6. CDP: wrong target/revision rejected, bounded frame buffer, disconnect/recovery and mobile portrait tests.
7. Terminal: no new execution privilege, control-sequence sanitization, session revocation, no external scripts, existing command policy unchanged.
8. Eight-hour concurrent mission soak: no lost mission, no duplicate execution, no unbounded queues or persistent GPU growth; compare runtime throughput against baseline with avatar off. Proposed regression budget <=10% throughput loss.
9. Build/typecheck, relevant regression CI, real-device evidence and operator visual review before merge.

## Open questions
Exact pinned upstream versions and complete dependency licenses, actual renderer extension API, browser voice endpoint and existing TTS reuse, GPU/CPU resource benchmarks, current branch CI and device test results remain unverified. Do not tick implementation tasks on documentation evidence alone.
