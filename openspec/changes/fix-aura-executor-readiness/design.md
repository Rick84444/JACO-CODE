# Design

The runtime identity identifies the execution profile. The existing Nova mission control provides a bounded, in-memory observation of its local Lite executor, refreshed by the actual worker after it enters its loop. The heartbeat grants no execution authority and does not mutate missions. An expired or missing heartbeat is not READY, including after a Core restart. Required Workplace health is checked independently from its supervision mode. No second planner, mission store or executor is introduced.

A launcher-managed child may be restarted only after its exit, using bounded backoff. Existing durable lease and unknown-outcome semantics remain authoritative. Host execution and CI must be verified separately.
