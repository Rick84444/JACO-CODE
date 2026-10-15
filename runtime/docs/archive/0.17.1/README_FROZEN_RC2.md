# JACO Autonomus IDE — Frozen Hands-Off + SEER Desktop RC2

This candidate freezes the Antigravity / AI Studio GUI as the canonical frontend and integrates a unified Hands-Off execution model for Android and Windows.

## Frozen product contract

- Canonical GUI: Antigravity / AI Studio.
- Primary local UI/runtime port: 3000.
- SEER work must remain visibly observable through the Live Workstream.
- Supported SEER phases: `IDLE`, `OBSERVING`, `PLANNING`, `EXECUTING`, `VERIFYING`, `DEGRADED`.
- Live state exposes primary goal, current subgoal, active module, provider/model, cycle/iteration, workers, verified events/receipts, blockers/drift, tools/skills, latest verified progress, next cycle and current Android/Desktop action.
- Live observability is operational evidence only; it does not expose private model chain-of-thought.

## Hands-Off architecture

Android:
`SEER -> Nova Traction -> HandsOffPlanRunner -> HandsOffClient -> Native Android Accessibility -> observe/act/observe -> verified receipt`

Desktop:
`SEER -> Nova Traction -> DesktopHandsOffClient -> Windows UI Automation -> observe/act/observe -> verified receipt`

Desktop actuation deliberately uses UI Automation patterns instead of synthetic keyboard/mouse injection. Credential/system-security surfaces are permanently refused. Passwords, OTPs, API keys, private keys and similar secrets require direct human entry.

## Truthfulness

An action returning without error is not enough. Mutating Hands-Off actions are only reported as verified when a post-action observation proves the expected state changed. Unsupported hardware/platform paths return `UNAVAILABLE` or `DEGRADED` instead of simulated success.

## Verification status

Observed in the build environment:
- Frozen Hands-Off verifier: 49/49 PASS.
- Truthful-runtime verifier: 15/15 PASS.
- Critical TypeScript/TSX transpile: 11/11 PASS.
- Whole source-tree TypeScript/TSX parser: 186/186 PASS.
- Common-secret scan: PASS.
- Termux Bash syntax: PASS.

Not yet physically verified:
- Full `npm ci`, `tsc --noEmit`, and Vite/esbuild production build: dependency installation timed out in the build container.
- Windows UI Automation actuation: requires a Windows host.
- Android Accessibility actuation: requires the physical Android native engine/service and grant.
- NPU execution: requires measured accelerator evidence on the target device.

Therefore this package is a **Release Candidate**, not a production certification.
