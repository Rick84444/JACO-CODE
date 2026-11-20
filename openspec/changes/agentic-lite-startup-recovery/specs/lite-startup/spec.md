## ADDED Requirements

### Requirement: Canonical Lite startup recovery
Lite SHALL use the requested port (3000 by default) and SHALL NOT silently choose another Core port. Lite SHALL inspect a live workspace ledger writer before spawning Core. A verified same-project current instance MAY be reused. With explicit recovery intent and positive identity evidence, Lite MAY gracefully stop its own prior launcher/core, then retry startup only after bounded verified exit and port availability. Unknown identity, shared/foreign state or unsuccessful recovery SHALL yield a diagnostic, without deleting ledger or lock or force killing processes.

#### Scenario: Another writer owns the workspace
- GIVEN a live prior writer for this workspace
- WHEN Lite is launched
- THEN it diagnoses the writer before spawning another Core and records the decision
- AND does not weaken the ledger's single-writer contract.

#### Scenario: Requested port is held by unrelated service
- GIVEN an unverified listener on the requested port
- WHEN Lite is launched
- THEN it does not kill the listener or silently change the port.
