## ADDED Requirements

### Requirement: Model prices come from a named source
Every price used for a cost quote SHALL carry its source and fetch time, and a paid model without any known price MUST NOT be called.

#### Scenario: Catalog price available
- **WHEN** a paid model is quoted and the price catalog lists it
- **THEN** the quote SHALL use the catalog price and report its source

#### Scenario: No price anywhere
- **WHEN** a paid model has no environment, file, catalog or operator default price
- **THEN** the quote SHALL fail with `MODEL_PRICE_UNKNOWN` and no call SHALL be made

### Requirement: One economy view
The GUI SHALL show costs, revenue, provider balances and prices in one Economy workspace, and SHALL show a figure that could not be read as not read, never as zero.

#### Scenario: Stripe not connected
- **WHEN** no Stripe key is configured
- **THEN** revenue SHALL be shown as not connected, not as 0

### Requirement: Local Ollama keeps the full prompt
A chat request to a local Ollama SHALL be sent with an explicit context size.

#### Scenario: Planner request to local Ollama
- **WHEN** the planner calls a loopback Ollama
- **THEN** the request SHALL go to `/api/chat` with `options.num_ctx` set

### Requirement: Organization permissions are enforced
A mapped Aura tool or Nova task SHALL run only when the agent and every manager above it hold an active, unexpired grant for the permission.

#### Scenario: Manager loses a permission
- **WHEN** a manager's grant is revoked
- **THEN** its reports' mapped actions needing that permission SHALL fail with `MANDATE_DENIED`
