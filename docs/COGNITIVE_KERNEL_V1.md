# JACO Cognitive Kernel v1

Status: **CANONICAL on `master` after PR #16 and PR #17.**

This slice extends existing Continuum owners. It does not introduce a second mission store, executor, memory engine, model router, authority plane, or financial path.

## Purpose

Close four related cognitive gaps as one evidence-constrained loop:

1. Semantic Repository Model
2. Runtime Self-Model
3. Outcome -> Knowledge Compiler
4. Cognitive Compression

The intended loop is:

`repository state -> hypothesis/execution outcome -> verified evidence -> canonical knowledge -> evidence-independent compression -> holdout validation -> reusable pattern -> future planning`

## Canonical ownership

- `KnowledgeStore` remains the canonical knowledge owner.
- `EvidenceLedger` remains the proof boundary.
- `HypothesisEngine` remains the hypothesis owner.
- `CapabilityCompiler` remains the trajectory/capability owner.
- SEER remains the strategic governor.
- Durable Nova / ModelRelay / Desktop AgentOS execution boundaries are unchanged.
- `RuntimeSelfModel` is a **derived projection** over canonical stores; it has no independent database.
- `CognitiveKernel` is a facade over canonical services, not a new control plane.

## Semantic Repository Model

`semanticRepositoryModel.mjs` creates a deterministic repository snapshot with:

- file hashes,
- TypeScript/JavaScript AST imports, declarations and exports when `typescript` is available,
- deterministic regex fallback,
- local dependency edges,
- detected HTTP routes,
- concept index,
- canonical-owner hints,
- test-file classification,
- scan completeness metadata.

A scan that reaches `maxFiles` or skips source files because of `maxFileBytes` is `PARTIAL`, never silently reported as complete. Structural snapshots are evidence-backed. Concept and owner classifications are deterministic derived metadata, not absolute architectural truth.

## Runtime Self-Model

`runtimeSelfModel.mjs` derives what JACO can currently justify about itself from observed runtime data. Capability state includes verified successes/failures, evidence coverage, Wilson lower-bound reliability and independent evidence-set count.

Three records that reuse the same proof do not count as three independent experiences.

## Outcome -> Knowledge

`outcomeKnowledgeCompiler.mjs` compiles verified terminal outcomes into the canonical `KnowledgeStore`.

- `VERIFIED` and `FALSIFIED` hypothesis outcomes require verified terminal evidence.
- Historical preliminary evidence remains provenance but does not define terminal truth.
- `UNKNOWN` outcomes stay unverified and cannot contradict or supersede existing knowledge.
- The same target cannot be marked both `CONTRADICTED` and `SUPERSEDED` in one compilation.
- A compiled outcome cannot invalidate itself.

## Cognitive Compression

`cognitiveCompressor.mjs` treats abstraction as a new claim that must earn verification.

- Source trajectories/knowledge must be verified.
- Repetition requires independent evidence sets, not duplicate references.
- Compression creates an `UNVERIFIED` pattern candidate.
- Promotion requires verified holdout/replay evidence that is independent from the source evidence.

Therefore verified examples do not automatically make a generalized rule verified.

## API surface

Both integrated and standalone Continuum expose the same authenticated cognitive surface:

- `GET /cognition` / `GET /api/continuum/cognition`
- `GET /cognition/self-model`
- repository scan/search/dependency endpoints
- hypothesis and generic outcome compilation endpoints
- knowledge/trajectory compression endpoints
- pattern validation endpoint

All integrated routes remain behind the existing Continuum auth gate. Standalone routes remain behind the existing standalone token/loopback auth boundary.

## Verification state

Focused local harnesses executed successfully for:

- TypeScript AST repository parsing,
- complete vs partial scan truth state,
- local dependency extraction,
- runtime self-model evidence-set independence,
- verified terminal outcome compilation,
- rejection of ambiguous/UNKNOWN knowledge invalidation,
- rejection of duplicate evidence-set compression,
- independent holdout-gated pattern promotion.

The full repository test suite and physical/runtime end-to-end execution have **not** been claimed by this slice.

## Canonical integration

PR #16 (`feat/helix-hypothesis-outcomes`) and PR #17 (`feat/helix-cognitive-kernel-v1`) are merged into canonical `master`. The Continuum Cognitive Gate validates locked dependency installation, Continuum regressions, and Reflective Futures regressions for subsequent changes.
