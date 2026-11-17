## ADDED Requirements

### Requirement: Profile-aware execution readiness
The activation report SHALL use the observed runtime profile and verify the local Lite durable executor independently of optional Workplace supervision.

#### Scenario: Lite worker alive and Workplace supervision disabled
- **WHEN** the runtime identifies Lite and a fresh authenticated local executor heartbeat is observed
- **THEN** disabled Workplace supervision SHALL NOT block activation unless required coordination itself is unhealthy

#### Scenario: Missing or stale executor observation
- **WHEN** the executor has never reported or its last heartbeat expires
- **THEN** activation SHALL NOT report ready, even if tools and models respond

#### Scenario: Full profile
- **WHEN** the full profile requires supervised Workplace execution
- **THEN** the existing supervised executor readiness requirements SHALL remain enforced

### Requirement: No authority escalation
Executor observations SHALL NOT create missions, grant permissions, or clear uncertain execution outcomes.

#### Scenario: Executor or Core restart
- **WHEN** the Core restarts or the executor disappears
- **THEN** readiness SHALL require a fresh observation and existing mission recovery rules SHALL remain unchanged
