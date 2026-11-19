# Fix Aura executor readiness

## Why
Lite starts the durable local executor itself while Workplace supervision is disabled. Activation must not interpret that expected configuration as a stopped worker, nor attest readiness without observing the executor.

## Scope
Use the runtime's observed profile and an authenticated, fresh executor heartbeat. Keep coordination optional in Lite unless explicitly required. Preserve the full runtime's existing supervision checks and all mission leases and policy boundaries.
