# ADDED Requirements
### Requirement: Timed opt-in
The runtime SHALL start commercial opportunity cycles only under a signed commercial clock.
#### Scenario: Revocation
- GIVEN a commercial mission
- WHEN the clock expires or is revoked
- THEN new claims and actions SHALL be denied and existing receipts SHALL remain reconcilable.
### Requirement: Single authority
The runtime SHALL use the existing Nova queue and KnowledgeStore, at most one new cycle per hour; unresolved work takes priority. Only specified tools SHALL be allowed.
#### Scenario: Missing credentials
- GIVEN no AgentGigs credential
- THEN discovery SHALL remain possible without write or payout claims.
### Requirement: Truthful economics
The runtime SHALL distinguish listing, proposal, funded assignment, delivery and independently verified settlement.
