# Fix Lite tool discovery and repeated missing-command stalls

## Problem
On Pixel Terminal (Debian arm64), the JACO Lite launcher uses a bundled Node executable, but spawned services and agents can inherit a PATH without that Node installation's bin directory. A mission contract selects `npm test` and the agent repeatedly fails with `npm: not found`, interleaving unsuccessful attempts with successful repository reads. The existing repeated-error detector can miss those interleaved cycles. Observed Pixel tests have not yet proven recovery.

## Scope
- Preserve one canonical Lite launcher and existing bounded shell / mission loop.
- Make the launcher supply its Node tool bin to all child environments without exposing secrets, changing permissions, installing packages, or broadening allowed commands.
- Detect a repeating missing-command blocker despite interleaved read-only steps. Nudge once; on recurrence use existing stalled-strategy recovery and report evidence rather than spinning.

## Acceptance / falsifier
- Isolated Linux launcher tests prove a missing PATH entry becomes present for the workplace, IDE and agent; no duplicate entries, operator PATH preserved.
- A test that alternates missing `npm` failures and successful file reads yields a deterministic stuck verdict; genuinely recovered tests do not.
- Existing test-contract checks reject non-contracted substitutions; no policy changes.
- Falsified if `npm test` still yields command-not-found on Pixel after installing an artifact built from this change, or if a successful changed environment is labelled stuck.

## Out of scope
No target-host claim, existing active-mission mutation, direct push to main, provisioning, new orchestrator or CLI permission extension.
