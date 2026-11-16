## ADDED Requirements

### Requirement: Retrieval from canonical memory
Aura SHALL retrieve a bounded read-only set of relevant nodes from its existing Continuum CognitiveGraphProjection before planning when the local service is available.

#### Scenario: Verified historic pattern
- **WHEN** the canonical graph returns a verified knowledge node relevant to the active goal
- **THEN** the native and structured planner MAY see its short provenance-bearing hint
- **AND** no tool permission, state mutation or independent memory owner SHALL be created

#### Scenario: Stale or unverified claim
- **WHEN** a graph node is stale, contradicted, superseded or unverified
- **THEN** the retrieved hint SHALL NOT present it as verified precedent

### Requirement: Bounded and non-blocking retrieval
Graph lookup SHALL NOT block an otherwise valid mission when the graph service is absent, unhealthy or malformed. Graph hints SHALL remain inside a bounded context budget.

#### Scenario: Missing graph endpoint
- **WHEN** the authenticated local graph endpoint is unavailable
- **THEN** Aura SHALL continue under its existing plan contract without graph hints

#### Scenario: External origin
- **WHEN** a graph lookup attempts a non-loopback address
- **THEN** the adapter SHALL refuse to send the request

#### Scenario: Very large graph
- **WHEN** a projection returns excessive matches or text
- **THEN** only a clipped subset SHALL enter the planner and the Context Packet SHALL maintain its existing hard budget
