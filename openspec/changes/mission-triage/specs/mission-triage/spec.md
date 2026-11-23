# Mission triage — additive requirements

## ADDED Requirements

### Superseded retries end, idle old missions wait
A retry of the same goal family with no verified progress MUST be cancelled when a newer attempt exists. An ACTIVE mission older than
the newest operator goal and idle for 15 minutes MUST be paused. A mission waiting for the operator, a paid order, a graph child, an
executing mission and a paused or ending mission MUST NOT be touched.

#### Scenario: four attempts at the same drill
- Given missions "Datorövning Q", "Q2", "Q3" and "Q4" with no verified receipts and Q4 newest
- When triage is applied
- Then Q, Q2 and Q3 are cancelled with the reason recorded and Q4 keeps running.

### No silent restart of a similar job
`start-goal` MUST NOT start a goal whose text equals an ACTIVE, unpaused mission's goal unless `allowDuplicate` is true, and MUST list
missions of the same family finished within 24 hours in `similarDone`.
