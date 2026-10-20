# JACO Cognitive Graph Projection v1

**Status:** implemented as a read-only projection; full Cognitive Graph Engine, temporal reconciliation, GraphRAG, and experimental memory gains are **not** claimed.

## Authority

The projection lives in `runtime/src/server/continuum/cognitiveGraphProjection.mjs`.
It reads the existing Continuum `KnowledgeStore`, `EvidenceLedger`, and
`SemanticRepositoryModel`. It never stores its own beliefs, grants tool
authority, runs a new planner, or mutates canonical knowledge status.

- `knowledge:<id>`: knowledge object's current **effective** verification state
- `file:<repository-relative-path>`: observed repository scan and file hash
- `evidence:<id>`: evidence ledger observation with an explicit verified flag
- `DEPENDS_ON`, `USED_IN`, `SUPPORTED_BY`, `IMPORTS`: exact stored references only

The graph is computed on demand. Keys are stable within the source identity.
`graphHash` hashes the projected nodes, edges and repository snapshot hash;
it does **not** certify semantic correctness or execution success.

## Invalidation and retrieval

A knowledge object bound via `metrics.repositorySnapshotHash` or
`implementation.repositorySnapshotHash` is marked effectively `STALE`
when the current repository snapshot hash differs. Resolved verified knowledge
dependencies inherit this derived staleness. Absent/unverified evidence can
only downgrade an effective VERIFIED claim; it cannot promote one.
Original KnowledgeStore records are never silently rewritten.

Unknown dependency names are **not** linked by semantic guesswork.
This version has no persistent temporal edge history, cross-source deletion
propagation, embedding index, or graph traversal optimized for large corpora.
It does not infer validity from timestamps alone.

Every query is bounded. The source scan is capped at 1,000 knowledge records
and 5,000 repository files, and incomplete projections identify that limit.
The API does not expose secret tool credentials or raw source code.

## Authenticated API surfaces

Canonical Express Continuum router (usually mounted under `/api/continuum`)
and the optional standalone Continuum server both expose:

- `GET /api/continuum/cognition/graph?limit=200`
- `GET /api/continuum/cognition/graph/search?q=retry&limit=20`
- `GET /api/continuum/cognition/graph/neighbors?id=knowledge:retry&depth=2`

All routes use the existing runtime authentication boundary.
`includeInactive=true` explicitly includes stale/superseded knowledge.

## Verification

```sh
npm run test:cognitive-graph --prefix runtime
npm run test:continuum-runtime --prefix runtime
```

The projection regression suite covers direct edges, evidence status, repository
revision changes, transitive staleness, bounded search, and graph traversals.

### Next gates before autonomous adoption

1. Integrate read-only graph search with SEER planning through an explicit
   bounded context contract; do not change the existing Mission Graph authority.
2. Test deleted-file invalidation, incremental scanning and partial snapshots.
3. Build temporal provenance and exact source-to-edge invalidation before
   claiming Graphiti-like historical correctness.
4. Measure performance and solution quality with and without retrieval,
   using identical tasks, models and independent acceptance tests.
5. Validate on physical Android and Windows and repair CI infrastructure.
