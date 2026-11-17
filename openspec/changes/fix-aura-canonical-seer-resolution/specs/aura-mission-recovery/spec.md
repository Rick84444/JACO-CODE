## ADDED Requirements

### Requirement: Canonical Aura resolution
Aura Core SHALL be the only automatic resolver for Nova missions. Strategy SHALL observe the durable result and SHALL NOT independently certify completion.

#### Scenario: Graph child awaiting verification
- **WHEN** a closed-loop graph child has verified evidence and the current operator policy permits completion
- **THEN** Core SHALL verify the current binding and claim review before resolving it, without an additional SEER approval.

#### Scenario: Approval or cancelled graph
- **WHEN** a child requires an operator decision, the parent is cancelled, or the binding does not match
- **THEN** automatic resolution SHALL NOT grant new authority.

### Requirement: Durable proof and conserved repair scope
Verification SHALL use authoritative durable receipts rather than the model's bounded context window. A repair SHALL preserve the original contract scope and not restore consumed execution budget.

#### Scenario: Long mission or single-node repair
- **WHEN** an older receipt leaves the context window or a known failure causes selective repair
- **THEN** the receipt SHALL remain verifiable and the replacement SHALL use at most the remaining contracted resources.
