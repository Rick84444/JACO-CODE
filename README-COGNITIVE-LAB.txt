JACO COGNITIVE LAB V2 — EXECUTABLE THREE-AGENT EXPERIMENT
=========================================================

This archive is an additive overlay for the JACO-CODE v0.22.0 source tree.
It does NOT modify production runtime, server.ts, or service supervisors.

1) BACK UP YOUR REPO. Extract this archive at the root of JACO-CODE.
2) Install a working Node.js 22+ runtime (no additional NPM packages needed for the lab).
3) Run from the root:

  node agents/cognitive-lab/run.mjs run --state .jaco/cognitive-lab
  node agents/cognitive-lab/run.mjs run --state .jaco/cognitive-lab
  node agents/cognitive-lab/run.mjs inspect --state .jaco/cognitive-lab

4) Run the included independent checks:

  node --test tests/cognitive-lab/cognitive-lab.test.mjs tests/nova/cognitive-capsule.test.mjs

Expected demonstration (one persistent state dir):
  Run 1: baseline 4/8 FAIL; hardened 8/8 PASS (2 candidates)
  Run 2: hardened 8/8 PASS immediately (1 candidate; knowledge reused)

Agent decision making is deterministic and the candidate source code is
predefined by the lab. Real localhost HTTP calls, real independent review,
real disk persistence, and actual role-based capability limitations are used.
This is NOT a deployed multi-LLM autonomous engineering system.

Docs: docs/cognitive/COGNITIVE_LAB.md
Dashboard: docs/cognitive/COGNITIVE_LAB_DEMO.html
