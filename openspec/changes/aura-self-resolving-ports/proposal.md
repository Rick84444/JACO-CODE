# Aura self-resolving startup ports

## Why
Operators must not wire ports or understand the stack. Today `agents/lib/local-stack.mjs` aborts activation with `PORT_CONFLICT_OR_UNHEALTHY:<service>` when a foreign process holds a service port, and `restartOwnedUnhealthyRuntime` returns `FOREIGN_LISTENER` without recovery. A second app on 3000 or 2995 therefore stops Aura until a human intervenes.

## What Changes
- Classify an occupied port: owned and healthy, owned and unhealthy, stale JACO process, or foreign.
- Owned and unhealthy: recycle through the existing guardian path. Stale JACO process: reclaim it.
- Foreign listener: never kill it; select the next free port, persist the choice, and propagate it to every dependent URL and environment variable.
- Report the resolution in startup status (`warnings`, observed ports) in plain language.

## Impact
Affected: `agents/lib/local-stack.mjs`, `agents/lib/health-guardian.mjs`, startup status. No new permission, spend or runtime owner. Baseline: `main` 96f3e48. Not yet implemented; target-host (Windows) behavior is unobserved.
