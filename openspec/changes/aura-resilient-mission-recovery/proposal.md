# Change: Aura resilient mission recovery

## Problem
Known, recoverable tool loops and temporary infrastructure failures can turn into permanent BLOCKED missions, even though JACO already has a structured planner and bounded graph repair runtime. The operator should not have to babysit technical recovery.

## Scope
Reuse the same canonical Aura mission state, leases, tools and approvals. Route (1) native-tool protocol stalls into the existing structured planner on the selected model, (2) repeated known-action loops in graph missions into the existing bounded graph repair, and (3) temporary runtime/browser-preflight outages into retryable deferred turns. Ensure failed release never claims successful repair.

## Non-goals
No permission expansion, new mission store, autonomous payments, fallback to unselected paid models, retry of unknown side effects, bypass of stop/pause, or replacement of existing approvals.

## Baseline
main 118f2970a6f4912cfa71f9818368470318f3905f. Workplace live coordination unavailable from this GitHub-only session: DEGRADED_UNSYNCED. Target Windows host unobserved.

## Acceptance
Every behavioral requirement in specs/aura-mission-recovery/spec.md is tested. Relevant CI and Windows installation still require independent observation before a production claim.
