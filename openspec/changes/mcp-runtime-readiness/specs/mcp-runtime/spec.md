## ADDED Requirements
### Requirement: MCP readiness and dispatch truth
The canonical MCP host SHALL distinguish known pre-dispatch refusal from a potentially dispatched mutation. The planner catalog SHALL NOT advertise stopped/failed or explicitly denied tools as ready. Discovery SHALL have a bounded waiting interval and SHALL NOT silently grant tasks. Perception convenience tools SHALL use the existing built-in browser MCP route.

#### Scenario: failed connector
- WHEN one connector is stopped, failing or slow
- THEN discovery SHALL retain observed healthy tools and SHALL NOT assume the failing connector is ready

#### Scenario: unknown mutation result
- WHEN a mutation is dispatched and its response is lost or reports an error without proof of no effect
- THEN the mission SHALL retain unknown outcome and SHALL NOT blindly repeat it.

#### Scenario: access revoked during initialization
- WHEN the operator changes access while a server initializes
- THEN the next dispatch SHALL use current access and refuse an unauthorized call.
