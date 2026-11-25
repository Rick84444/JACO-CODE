# Tasks

- [x] Stage page with Aura's rig, conversation on the shared chat session, holograms for strategy, browser and tools (headless Chromium under the runtime CSP: rig loads, no console errors)
- [x] `[[jaco:focus mission|browser|tools]]` directive in `workspaceActions.mjs`, instruction sent only for the stage source (`workspaceActions.test.mjs`)
- [x] Runtime serves the stage at `/`, the IDE at `/ide`; remote sessions and slim releases keep the IDE (`operator-stage-assets.test.mjs`; observed `/` and `/ide` 200)
- [x] Startup readiness finds the IDE at `/ide` (`startup-safety.test.mjs`; observed READY / HTTP_READY)
- [x] Live browser frame and page address read paths (`/api/aura/browser/live-frame`, `/api/aura/browser/page`)
- [x] Voice: neural Sofie first, Piper fallback (observed audio/ogg through the runtime)
- [x] One 240 s budget per chat turn (`aura-always-answers.test.mjs`)
- [x] 20 tool calls per answer, larger work continues through `start_goal` (`aura-seer-chat.test.mjs`)
- [x] Browser input contract: `expectedUrl` required and filled from the current page (`cdp-mcp-contract.test.mjs`, `aura-mcp-lazy-start.test.mjs`; observed Google search typed and submitted)
- [x] Screenshots do not bring a visible page forward (`bridges.test.mjs`)
- [ ] Operator verification in their own Chrome: microphone talk mode, audio playback with lip sync, window no longer jumping forward
