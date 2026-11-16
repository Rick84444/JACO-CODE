# Design

## Lite environment ownership
In `lite/start.mjs`, create a single normalized child environment using the directory of the actual Node executable (`process.execPath`, or the injected test executable). Prepend to PATH without replacing existing paths or duplicating entries. Preserve Windows' case-insensitive PATH key. Pass the same normalized environment to Workplace, IDE and Nova child processes. The bounded `SafeShell` already passes PATH through its minimal command environment, so no new command privileges are needed.

## Failure loop
Extend the existing `StuckDetector` rather than introducing a second planner. Record a canonical `missing-tool` fingerprint only for clear command-launch failures. If the same missing command fails three times in a bounded window, even with successful reads in between, emit an actionable stuck verdict. Fresh tool availability or a successful execution of the formerly missing command ends the obsolete blocker window. Leverage existing one-nudge then strategy-recovery behavior; never try a disallowed command on behalf of the agent.

## Evidence
Unit tests run on development platform; CI on PR SHA; Pixel Terminal tests and actual artifact rollout remain separate evidence levels.
