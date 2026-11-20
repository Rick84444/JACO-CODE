# Diagnose and recover Lite startup conflicts

## Observed defect
A second Pixel Debian Lite launch fails with LEDGER_LOCKED after port 3000 is freed; the old writer may be on another port. Automatic port drift also disconnects clients expecting 3000.

## Scope
Extend the existing Lite launcher, not the runtime or ledger. Default to port 3000, diagnose the current writer before launching children, reuse a verified matching instance, and allow a bounded graceful handoff of a positively identified old Lite supervisor or orphan under explicit --recover. Keep state and operator policy. No blind kills, force kill, lock deletion, new scheduler or replay of uncertain actions.
