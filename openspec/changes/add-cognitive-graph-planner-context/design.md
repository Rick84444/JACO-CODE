# Design: cognitive graph hints inside the canonical mission loop

1. Existing `CognitiveGraphProjection.search` owns truth about effective knowledge verification status and repository snapshot.
2. The native `contextPacketIntro` path and structured `callBrainStep` path request at most eight goal terms from the local Core `/api/continuum/cognition/graph/search`.
3. A small pure consumer discards stale, superseded, unverified and unsupported node types. Only `KNOWLEDGE:VERIFIED` and `FILE:OBSERVED` pass with their explicit status and graph revision.
4. Retries are not added. The read has a short timeout and returns null on failure; unavailable graph is not evidence of absent knowledge.
5. The Context Packet owns the combined budget, trims historical observations then graph hints as needed. Both model paths present graph content as untrusted advice, never task authority.
6. Existing Durable Mission Bus and SEER/Aura graph keep all execution ownership.

Risks: lexical lookup can miss semantic matches and on-demand projection can be computationally expensive. Benchmark retrieval and end-to-end quality on live Windows before a broader rollout. External implementations (Graphiti, OpenHands, LangGraph) remain reference patterns, not runtime dependencies.
