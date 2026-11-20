# Bonsai on-device Android control through private ChatGPT/Aura Relay

## Problem
The local Bonsai 4B llama.cpp endpoint exists as a provider candidate, but it cannot itself act on Android UI. JACO already owns Native Android Accessibility Hands-Off, semantic receipts, a signed mandate store, single-writer actuator leases and an authenticated private Aura MCP connection. A second agent or GitHub-command actuator would duplicate authority.

## Proposal
Add one bounded observe-plan-act adapter that uses local Bonsai inference and existing Android Hands-Off. Expose it through the existing Core model-relay router and private Aura MCP profile; do not change public ChatGPT Git-ref or issue message transports.

## Boundaries
- MVP requires Core, llama.cpp Bonsai and Android Native Engine on the same Android host; no claim of Windows-to-Android remote transport.
- Native Android Accessibility must have been enabled explicitly by the operator.
- Operator-signed mandate with explicit Android package scope is mandatory; no new shell, ADB, login, purchasing, publishing or sensitive-system automation privileges.
- Only semantic UI targets are accepted; no guessed tap coordinates.
- Every action is observed and receipt-verified; a model's self-reported completion is not by itself evidence.
- Keep one Aura/SEER operator and preserve the existing device registry.
- No secrets or screen text are published through public GitHub or MCP receipts.

## Acceptance and falsifier
Accept source functionality if unit tests cover allowed unique targets, blocked sensitive targets, unsupported permissions, package mismatch, unverified completion, and prelaunch from the wrong foreground app; Core route requires auth and a signed mandate. Reject a production-ready claim without physical Pixel tests plus a genuinely connected ChatGPT private MCP client.
