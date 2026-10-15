# JACO Cognitive Continuity Runtime v1

Status: implementation slice on `cognitive-continuity-runtime-v1`.

## Purpose

Give JACO a restart-resumable cognitive working state without creating another
mission store, memory database, planner, authority plane, or execution loop.

The continuity layer is intentionally small. It persists only the state needed
for a later model invocation to resume the same line of work:

- stable `continuityId`
- focused durable mission reference
- focused hypothesis-set reference
- current attention
- unresolved questions
- next cognitive actions
- canonical working references
- last model identifier when available

Every mutation is stored as a full bounded state event in Continuum's existing
hash-chained `ContinuumEventStore`. Restart reconstruction therefore depends on
the canonical ledger, not on an additional state database.

## Canonical ownership

Continuity does **not** own:

- durable Nova missions
- mission receipts
- knowledge
- hypotheses
- evidence
- skills
- model routing
- resource authorization

In the integrated runtime, mission truth comes from
`ConnectedRuntime.novaMissions` / `DurableMissionBus`. The continuity runtime
is bound to that source after both runtimes are constructed.

Continuum's older `MissionLedger` remains untouched by this slice and is not
silently treated as the durable Nova mission authority.

## Model envelope

`GET /api/continuum/continuity/model-envelope` returns a compact projection for
a reasoning model. It includes:

- durable mission objective and compact receipt status
- bounded working state
- open questions and open hypothesis summaries
- selected epistemic unknowns
- repository/knowledge summary

The model may propose only bounded working-state updates. A model response cannot
mint mission authority, permissions, ownership, economic authority, or arbitrary
runtime fields.

## External human relationship

Human input is not represented as a reward function or utility target in this
runtime. Resource authorization and ownership remain separate technical
concerns.

The continuity envelope can carry the consequences of communication through
missions, evidence, knowledge and bounded working state, but a human is not a
required cognitive step between plan, action and verification.

This is an architectural separation, not a claim that JACO is conscious or has
subjective experience.

## Checkpoints

Continuity checkpoints store the current cognitive working state plus a compact
reference to the durable mission at that moment.

Restoring a checkpoint restores **only cognitive working state**. It never rolls
back:

- a durable mission
- external side effects
- evidence
- Git history
- knowledge
- financial state

Those remain owned by their canonical systems.

## Nova integration

Before a Nova planning turn:

1. Nova requests the current continuity model envelope.
2. The envelope is added to the planner context.
3. The planner returns one executable task plus a compact `continuity` delta.
4. Only allowlisted continuity fields are written back.
5. Mission execution continues through the existing DurableMissionBus path.

If continuity is temporarily unavailable, Nova continues through the existing
mission path and logs the continuity failure. Continuity is therefore not a new
single point of failure for actuation.

## Verification target

The source-level acceptance test requires:

1. create continuity state,
2. create a checkpoint,
3. diverge the working state,
4. restore the checkpoint,
5. construct a fresh EventStore and fresh CognitiveContinuityRuntime over the
   same persisted ledger,
6. prove identical reconstructed state,
7. prove event-chain integrity,
8. prove durable mission state was not mutated by continuity restore.

This is source/runtime verification only. Target-host crash/restart persistence
still requires execution on the real JACO host.
