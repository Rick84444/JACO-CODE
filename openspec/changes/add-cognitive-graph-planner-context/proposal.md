# Add bounded cognitive graph retrieval to Aura planning

## Why
Aura's canonical Continuum graph already derives verified knowledge and repository relationships, but neither the native nor structured mission planner reads it as bounded context. A long mission can therefore repeat exploration while graph evidence exists.

## What changes
- Add one read-only local client for the existing Continuum graph search API.
- Provide a bounded projection of verified knowledge and observed files to both planning protocols.
- Fail open for availability (no mission block when graph is offline), but fail closed for trust, credentials, transport and authorization.
- Keep mission authority, tool grants, memory stores, and lifecycle unchanged.
- Add focused regressions. Do not install external agent frameworks.

## Non-goals
No new graph store, planner, autonomous goal generation, semantic assertion, side-effect replay, or Windows deployment.

## Falsifier
Stale/unverified knowledge appears as verified in a planning turn; malformed or unreachable graph blocks mission; graph content expands allowed tasks; or context budget exceeds configured bounds.

## Verification status
Source inspection + isolated helper tests only at authoring. Full JACO CI, integrated plan tests and physical Windows live mission remain unverified.
