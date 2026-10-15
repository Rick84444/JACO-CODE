# Autonomous local integration contract and verification

The canonical owners remain SEER's mission graph, DurableMissionBus/NovaMissionControl, Nova's planner and coding workspace, and the existing private learning store. There is no alternate execution or knowledge engine.

## Implemented runtime behavior

- Before a coding planning call, Nova observes the configured workspace revision, runtime identity, available task contracts, the operator's shared budget context and relevant historical outcomes. The lease-protected preflight is durable. Missing prerequisites block planning rather than producing a success status.
- A coding contract can declare up to ten scoped Node service entries through services [{id,entry,healthPath,identity}]. repo-service {id,action:start|status|stop} executes only these entries, allocates an actual loopback port, hides the Windows process, and records PID plus process birth before readiness. It reuses an owned process after executor restart, refuses changed source/entry, and strips provider credentials from the child environment. Operational logs reject links.
- verification.required_stages can require service, api and browser observations after the latest source write. web-fetch accepts an explicit status/body expectation. Browser mutations on an allocated integration origin require the active mission/action and a fresh verified contracted service receipt. No origin is globally whitelisted by this grant.
- Browser click verification waits for a bounded observable transition, including asynchronous API rendering. Screenshot capture activates Nova's selected tab before requesting actual compositor image data.
- The graph propagates its main goal and node dependencies into the durable Nova mission. Existing leases, receipts, checkpoints and unknown-outcome rules continue to govern recovery.
- Structured reflections contain actual receipt references, successful/failed tools and argument names, constraints and the observed repository revision. A different revision marks recalled outcomes STALE. Historical success is context, not current proof. This is not evidence of an A/B improvement in problem-solving ability.
- Aura shows observed preflight, recent receipt counts, missing verification gates and a concrete recovery instruction. Receipt counts refer to the retained recent window, not lifetime work.

## Reproducible regression and live checks

Root package dependencies now include express because canonical runtime routers are imported by root regression tests. The root lock is regenerated without existing node_modules and verified by npm ci --ignore-scripts --omit=optional --no-audit --no-fund in an isolated source checkout. MCP expectations include the actual Cloudflare adapter. Workplace delivery tests wait for processing AND durable ACK; executor routing is tested behaviorally.

Run npm test, npm run test:workplace and npm run test:self-development for offline regression contracts. These do not prove a running browser. Run npm run verify:browser-live against the configured authenticated Nova Bridge for actual live observations. Missing bridge or credentials exits nonzero by default; --allow-skip is only an explicit optional diagnostic. The live script is outside the offline test glob.

The root install.sh builds the canonical configured runtime and uses agents/lib/local-stack.mjs for a full stack. It never falls back to an agent-only npm start. The full-stack launcher currently supports Windows; the installer fails explicitly on unsupported Unix/Termux full-stack use. A separate runtime-package installation is not equivalent to a full-stack installation. Clean physical-machine installation, reboot, update and rollback remain release requirements.

## Recorded Windows acceptance, 2026-10-06

Real Ollama Cloud gpt-oss:120b planning selected the actions; no fixed plan was injected. Nova wrote normalize.mjs, four behavior/error tests, and a real Node HTTP API plus an API-backed HTML form. Graph muwzkd1f-z1cou completed two nodes. The first has eight successful verified receipts; the browser node has seven successful verified receipts and one failed NO_TARGET observation before a corrected successful click.

A second graph mux04gm6-43ho5 and its pending mission were saved before a controlled Workplace/SEER/Nova restart. The supervisor PID changed from 33088 to 75596. The contracted API retained PID 9580, its creation timestamp and URL http://127.0.0.1:61817. Nova resumed the pending mission and completed five verified service/API/browser receipts. This proves pending-work recovery and retention of completed evidence; it does not prove recovery during an unknown mutation or a physical Windows reboot.

An independent acceptance harness checked four additional input/expected-output pairs, five invalid inputs, four actual HTTP responses and HTTP400 for empty input. It then entered a different browser value and observed the actual API-backed visible result Autonomous Engineering, with a real PNG capture. Nova Bridge's nine live checks passed. A deliberately missing bridge exited 1.

Generated source and full receipts stay in ignored local .jaco/verification and the Nova worktree. They contain installation-specific operational context and are not published with this document. The final local receipt identifies evidence files and exact Git delivery separately.

## Not established by this acceptance

General autonomous reliability across arbitrary repositories; restart during an unknown external mutation; clean OS installation/reboot; update and rollback on real hardware; physical Android session; cross-device private-memory synchronization; production Cloudflare deployment; cognitive improvement measured with/without experience. Passing counts are scenario coverage, not a reliability percentage.
