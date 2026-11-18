# Harden JACO START

## Why
Startup must be reliable and understandable without operator knowledge of internal services. Source inspection identifies mandatory Workplace configuration and separate setup/start entry points; actual host failure modes require reproduction.

## What Changes
- Consolidate startup through existing local-stack and setup owners.
- Verify identity, dependency readiness, provider and capabilities; distinguish READY, DEGRADED and BLOCKED.
- Preserve mission state and authentication; recover only owned processes with bounded retries.
- Add reproducible Windows cold-start and restart evidence.

## Impact
Affected: agents/lib/local-stack.mjs, scripts/setup.mjs, CLI, existing startup evidence, runtime and client status. No new runtime, policy bypass, external deployment or paid provider calls.
