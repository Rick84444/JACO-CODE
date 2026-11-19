# ADDED Requirements
### Requirement: Evidence-led commercial decisions
The toolkit SHALL distinguish forecast contribution, provider earnings and independent settlement.
#### Scenario: Funded text delivery
- GIVEN a funded assigned in-progress job and reviewed staged artifact hash
- WHEN delivery is invoked
- THEN upload and submit SHALL be attempted once and read back before reporting success.
#### Scenario: Ambiguous outcome
- GIVEN an ambiguous mutation
- THEN replay SHALL be denied across restart.
